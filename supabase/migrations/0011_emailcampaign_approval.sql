-- Kyveriqx — emailcampaign tool: owner approval gate.
--
-- Why this exists:
--   Email sending is abuse-prone (a bad actor can torch our sending reputation
--   and get our OAuth app flagged by Microsoft). So a customer must be approved
--   by the owner before they can connect a mailbox or send. The customer clicks
--   "Request access" → a row lands here as 'pending' → the owner approves (or
--   rejects) it in the admin panel (/admin/approvals).
--
--   This is a Kyveriqx-side gate, separate from the customer's own Microsoft
--   sign-in, and it layers on top of the trial/subscription entitlement — both
--   must pass. Admins (profiles.is_admin) are treated as approved in the app so
--   the owner can test without approving themselves.

create table if not exists public.emailcampaign_approvals (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  status       text not null default 'pending',   -- 'pending' | 'approved' | 'rejected'
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users(id),
  admin_notes  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.emailcampaign_approvals enable row level security;

-- Idempotent drop-then-create (same pattern as 0007). A user may read their own
-- row and INSERT their own request — but only as 'pending', so they cannot
-- self-approve. Status changes happen exclusively through the admin server
-- action (service role, which bypasses RLS); hence no user update/delete policy.
drop policy if exists "emailcampaign_approvals_self_select" on public.emailcampaign_approvals;
create policy "emailcampaign_approvals_self_select"
  on public.emailcampaign_approvals for select
  using (auth.uid() = user_id);

drop policy if exists "emailcampaign_approvals_self_request" on public.emailcampaign_approvals;
create policy "emailcampaign_approvals_self_request"
  on public.emailcampaign_approvals for insert
  with check (auth.uid() = user_id and status = 'pending');

-- Lets a previously-rejected user re-request: the upsert becomes an UPDATE.
-- The check still pins status to 'pending', so a user can never move their own
-- row to 'approved' — only the admin action (service role) can.
drop policy if exists "emailcampaign_approvals_self_rerequest" on public.emailcampaign_approvals;
create policy "emailcampaign_approvals_self_rerequest"
  on public.emailcampaign_approvals for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id and status = 'pending');
