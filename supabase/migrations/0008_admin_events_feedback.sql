-- Kyveriqx — admin control panel: role flag + soft-disable, activity log,
-- and a user feedback inbox (reviews / issues / tool requests).
--
-- Three concerns, one migration:
--   1. profiles.is_admin / profiles.is_active — gate the /admin surface and
--      let an admin soft-disable a user (checked in app/tools/layout.tsx).
--   2. public.events — the activity log. Existing tables already capture report
--      runs/durations/errors (jobs) and subscription state (subscriptions); this
--      fills the gaps they can't: visits, tool opens, and report view-vs-download.
--      Locked down (RLS on, no policies) — only the service role writes/reads it,
--      so every track call flows through a trusted server route.
--   3. public.feedback — reviews, bug reports (auto-tagged to a tool), and new
--      tool requests. Users insert/read their own; admin triages via service role.
--
-- Idempotent throughout (re-runnable): add column if not exists, create table if
-- not exists, drop policy if exists before create. Mirrors 0007_emailcampaign.sql.

-- ---------- profiles: admin role + soft-disable -----------------------------

alter table public.profiles add column if not exists is_admin  boolean not null default false;
alter table public.profiles add column if not exists is_active boolean not null default true;

-- Seed the founder as admin (no-op if the profile row doesn't exist yet — the
-- signup trigger creates it on email confirmation; re-running this migration
-- after that will flip the flag).
update public.profiles set is_admin = true where email = 'chandrakant.kant26@gmail.com';

-- ---------- events (activity log) -------------------------------------------

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,  -- null = anonymous visit
  tool_id     uuid references public.tools(id) on delete set null,
  job_id      uuid references public.jobs(id) on delete set null, -- set for view/download events
  type        text not null,        -- 'visit' | 'tool_open' | 'report_view' | 'report_download' | 'login' | 'signup'
  path        text,                 -- request path, when known
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_created_idx on public.events (created_at desc);
create index if not exists events_user_idx    on public.events (user_id);
create index if not exists events_tool_idx    on public.events (tool_id);
create index if not exists events_type_idx    on public.events (type);

-- RLS on with NO policies: denies all anon/authenticated access. The service
-- role (supabaseAdmin) bypasses RLS, so writes flow through /api/events and
-- reads happen only in the admin panel — the raw log is never client-exposed.
alter table public.events enable row level security;

-- ---------- feedback (reviews / issues / tool requests) ---------------------

create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  tool_id      uuid references public.tools(id) on delete set null,  -- set for tool-scoped issues
  kind         text not null,        -- 'review' | 'issue' | 'tool_request'
  rating       int,                  -- 1–5, reviews only
  subject      text,
  body         text not null,
  status       text not null default 'open',  -- 'open' | 'in_progress' | 'resolved' | 'closed'
  admin_notes  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists feedback_status_idx  on public.feedback (status);
create index if not exists feedback_kind_idx     on public.feedback (kind);
create index if not exists feedback_created_idx  on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- A user may submit feedback as themselves and read back their own submissions.
-- Admin reads/updates run through the service role (no RLS path needed). The
-- nullable user_id allows service-role/system rows; the with-check ties any
-- client insert to the caller.
drop policy if exists "feedback_self_insert" on public.feedback;
create policy "feedback_self_insert"
  on public.feedback for insert
  with check (auth.uid() = user_id);

drop policy if exists "feedback_self_select" on public.feedback;
create policy "feedback_self_select"
  on public.feedback for select
  using (auth.uid() = user_id);
