-- Standardise the free trial at 15 days (was 14 in 0001_init.sql).
--
-- Business rule: every tool starts a 15-day trial on signup with NO card and
-- NO charge. A Razorpay subscription is only ever created when the user
-- explicitly clicks Subscribe (POST /api/billing/subscribe) — typically after
-- the trial — so nothing is billed during the 15 days.
--
-- Fixes both the column default and the signup trigger.

alter table public.subscriptions
  alter column trial_ends_at set default (now() + interval '15 days');

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

  -- Start a 15-day trial for every active tool.
  insert into public.subscriptions (user_id, tool_id, status, trial_started_at, trial_ends_at)
  select new.id, t.id, 'trial', now(), now() + interval '15 days'
  from public.tools t
  where t.is_active = true
  on conflict (user_id, tool_id) do nothing;

  return new;
end;
$$;

-- Extend trials already in progress to the full 15 days — they were created
-- under the old 14-day default. Only touches rows still on trial.
update public.subscriptions
set trial_ends_at = trial_started_at + interval '15 days',
    updated_at = now()
where status = 'trial';
