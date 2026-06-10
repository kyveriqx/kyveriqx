-- Kyveriqx — emailcampaign tool: OAuth mailbox connections.
--
-- Why this exists (Architecture §8.5, follow-up to 0007):
--   Microsoft 365 disables SMTP AUTH by default and hides the toggle, so the
--   password-based path in user_smtp_credentials is unusable for most M365
--   business users. Instead the user clicks "Connect Microsoft", signs in on
--   Microsoft's own site (OAuth 2.0 + PKCE), and we store a refresh token. The
--   Trigger.dev worker mints an access token at send time and sends via the
--   Graph API — no SMTP, no password ever reaches us.
--
--   The refresh token is encrypted at the application layer with AES-256-GCM
--   (same SMTP_ENCRYPTION_KEY + core/lib/smtp-crypto.ts as the SMTP password).
--   The DB stores only ciphertext + IV.
--
-- A user may have a row here (OAuth) OR a row in user_smtp_credentials (custom
-- SMTP), or neither. The app treats "has a sending method" as the union.

create table if not exists public.user_mail_oauth (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  provider           text not null,        -- 'microsoft' (room for 'google' later)
  account_email      text not null,        -- the connected mailbox / from address
  display_name       text,                 -- user's name from the id_token, if present
  refresh_token_enc  bytea not null,       -- AES-256-GCM ciphertext + 16-byte tag suffix
  refresh_token_iv   bytea not null,       -- 12-byte GCM nonce
  scope              text,                 -- granted scopes, space-delimited
  from_name          text,                 -- optional display-name override for the From header
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.user_mail_oauth enable row level security;

-- Drop-if-exists before create so the migration is safely re-runnable, same
-- idempotent pattern as 0007's user_smtp_credentials policies.
drop policy if exists "mail_oauth_self_select" on public.user_mail_oauth;
create policy "mail_oauth_self_select"
  on public.user_mail_oauth for select
  using (auth.uid() = user_id);

drop policy if exists "mail_oauth_self_insert" on public.user_mail_oauth;
create policy "mail_oauth_self_insert"
  on public.user_mail_oauth for insert
  with check (auth.uid() = user_id);

drop policy if exists "mail_oauth_self_update" on public.user_mail_oauth;
create policy "mail_oauth_self_update"
  on public.user_mail_oauth for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "mail_oauth_self_delete" on public.user_mail_oauth;
create policy "mail_oauth_self_delete"
  on public.user_mail_oauth for delete
  using (auth.uid() = user_id);
