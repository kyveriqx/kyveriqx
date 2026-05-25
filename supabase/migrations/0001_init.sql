-- Kyveriqx — initial schema (Architecture §8.4).
-- Tables: profiles, orgs, tools, subscriptions, uploads, jobs.
-- The "golden rule" (Architecture §9): every tool is a row in `tools`.

-- ---------- helpers ----------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------- orgs -------------------------------------------------------------

create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- profiles (1:1 with auth.users) -----------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid references public.orgs(id) on delete set null,
  email       text not null,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- ---------- tools (the catalogue — the golden rule) --------------------------

create table if not exists public.tools (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,                 -- folder name in /tools/<slug>
  subdomain   text not null unique,                 -- <subdomain>.kyveriqx.com
  name        text not null,
  description text,
  price       numeric(10,2) not null default 0,     -- INR per month
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Seed the six tools that ship with Step 1.
insert into public.tools (slug, subdomain, name, description, price) values
  ('gstledgerreco',    'gstledgerreco',    'GST Ledger Reconciliation',  'Match GST 2A/2B against books.',         99),
  ('bankledgerreco',   'bankledgerreco',   'Bank Ledger Reconciliation', 'Bank statement vs books reconciliation.', 99),
  ('orgledgerreco',    'orgledgerreco',    'Org Ledger Reconciliation',  'Inter-entity ledger reconciliation.',     99),
  ('custportal',       'custportal',       'Customer Portal',            'Self-service portal for customers.',     199),
  ('callingtool',      'callingtool',      'AI Calling Tool',            'Place calls via Plivo/Exotel/Twilio.',   199),
  ('whatsappcampaign', 'whatsappcampaign', 'WhatsApp Campaigns',         'Templated WhatsApp campaign sends.',     199)
on conflict (slug) do nothing;

-- ---------- subscriptions (per-user × per-tool) ------------------------------

create type public.subscription_status as enum ('trial', 'active', 'expired', 'cancelled');

create table if not exists public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  tool_id                 uuid not null references public.tools(id) on delete cascade,
  status                  public.subscription_status not null default 'trial',
  trial_started_at        timestamptz not null default now(),
  trial_ends_at           timestamptz not null default (now() + interval '14 days'),
  current_period_end      timestamptz,
  razorpay_subscription_id text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (user_id, tool_id)
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists subscriptions_tool_idx on public.subscriptions (tool_id);

-- ---------- uploads (file references in storage) ----------------------------

create table if not exists public.uploads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  tool_id      uuid not null references public.tools(id) on delete cascade,
  storage_path text not null,         -- key in the Supabase storage bucket
  filename     text not null,
  size_bytes   bigint not null,
  created_at   timestamptz not null default now()
);

create index if not exists uploads_user_tool_idx on public.uploads (user_id, tool_id);

-- ---------- jobs (Trigger.dev run state, mirrored into Supabase) ------------

create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  tool_id         uuid not null references public.tools(id) on delete cascade,
  trigger_run_id  text,
  job_key         text not null,         -- e.g. 'gst-ledger-reconcile'
  status          public.job_status not null default 'queued',
  payload         jsonb not null default '{}'::jsonb,
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists jobs_user_idx on public.jobs (user_id);
create index if not exists jobs_tool_idx on public.jobs (tool_id);
create index if not exists jobs_status_idx on public.jobs (status);

-- ---------- RLS --------------------------------------------------------------

alter table public.orgs          enable row level security;
alter table public.profiles      enable row level security;
alter table public.tools         enable row level security;
alter table public.subscriptions enable row level security;
alter table public.uploads       enable row level security;
alter table public.jobs          enable row level security;

-- tools: everyone can read the catalogue.
create policy "tools_read_all" on public.tools
  for select using (true);

-- profiles: a user can read/update their own profile.
create policy "profiles_self_read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles for update using (auth.uid() = id);
create policy "profiles_self_insert" on public.profiles for insert with check (auth.uid() = id);

-- subscriptions / uploads / jobs: user-scoped.
create policy "subs_self"    on public.subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "uploads_self" on public.uploads       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jobs_self"    on public.jobs          for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- auto-create profile + start trials on signup --------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  -- Start a 14-day trial for every active tool.
  insert into public.subscriptions (user_id, tool_id, status, trial_started_at, trial_ends_at)
  select new.id, t.id, 'trial', now(), now() + interval '14 days'
  from public.tools t
  where t.is_active = true
  on conflict (user_id, tool_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
