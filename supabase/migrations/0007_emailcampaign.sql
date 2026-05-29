-- Kyveriqx — emailcampaign tool: seed catalogue row, per-user SMTP
-- credentials store, and the recipient-list upload bucket.
--
-- Tool model (one folder per tool, per the golden rule in 0001_init.sql):
--   /tools/emailcampaign/ — minimal blast: CSV/Excel recipients + subject +
--   HTML body with {{name}} merge, sent via the user's own SMTP relay.
--
-- The user's SMTP password is encrypted at the application layer with
-- AES-256-GCM (see core/lib/smtp-crypto.ts). The DB stores only ciphertext +
-- IV — even with raw DB access an attacker can't recover the password
-- without SMTP_ENCRYPTION_KEY from the server env.

-- ---------- catalogue row ---------------------------------------------------

insert into public.tools (slug, subdomain, name, description, price) values
  ('emailcampaign', 'emailcampaign', 'Email Campaigns',
   'Send templated emails with {{name}} merge to a CSV/Excel list via your own SMTP.',
   99)
on conflict (slug) do nothing;

-- Backfill: every existing user gets a 15-day trial on this new tool, same
-- as if they had just signed up. Matches the trigger logic in 0006_trial_15_days.sql.
insert into public.subscriptions (user_id, tool_id, status, trial_started_at, trial_ends_at)
select u.id, t.id, 'trial', now(), now() + interval '15 days'
from auth.users u
cross join public.tools t
where t.slug = 'emailcampaign'
on conflict (user_id, tool_id) do nothing;

-- ---------- per-user SMTP credentials --------------------------------------

create table if not exists public.user_smtp_credentials (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  provider     text not null,            -- 'gmail' | 'office365' | 'zoho' | 'outlook' | 'yahoo' | 'other'
  host         text not null,            -- resolved from preset for known providers; user-entered for 'other'
  port         int  not null,
  secure       boolean not null default true, -- true = implicit TLS (465); false = STARTTLS (587)
  username     text not null,
  password_enc bytea not null,           -- AES-256-GCM ciphertext + 16-byte tag suffix
  password_iv  bytea not null,           -- 12-byte GCM nonce
  from_email   text not null,
  from_name    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.user_smtp_credentials enable row level security;

-- Drop-if-exists before create so the migration is safely re-runnable on
-- environments where a previous run already created the policies. CREATE
-- POLICY (without IF NOT EXISTS, unavailable in older Postgres) errors on
-- duplicate; this pattern is no-op on first run, idempotent on re-run.
drop policy if exists "smtp_creds_self_select" on public.user_smtp_credentials;
create policy "smtp_creds_self_select"
  on public.user_smtp_credentials for select
  using (auth.uid() = user_id);

drop policy if exists "smtp_creds_self_insert" on public.user_smtp_credentials;
create policy "smtp_creds_self_insert"
  on public.user_smtp_credentials for insert
  with check (auth.uid() = user_id);

drop policy if exists "smtp_creds_self_update" on public.user_smtp_credentials;
create policy "smtp_creds_self_update"
  on public.user_smtp_credentials for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "smtp_creds_self_delete" on public.user_smtp_credentials;
create policy "smtp_creds_self_delete"
  on public.user_smtp_credentials for delete
  using (auth.uid() = user_id);

-- ---------- storage bucket for recipient-list uploads ---------------------

-- Path layout (mirrors ledger-uploads in 0002_storage.sql):
--   emailcampaign-uploads/<auth.uid>/<upload-id>-recipients-<filename>

insert into storage.buckets (id, name, public)
values ('emailcampaign-uploads', 'emailcampaign-uploads', false)
on conflict (id) do nothing;

drop policy if exists "emailcampaign_uploads_select_own" on storage.objects;
create policy "emailcampaign_uploads_select_own"
  on storage.objects for select
  using (
    bucket_id = 'emailcampaign-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "emailcampaign_uploads_insert_own" on storage.objects;
create policy "emailcampaign_uploads_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'emailcampaign-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "emailcampaign_uploads_delete_own" on storage.objects;
create policy "emailcampaign_uploads_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'emailcampaign-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
