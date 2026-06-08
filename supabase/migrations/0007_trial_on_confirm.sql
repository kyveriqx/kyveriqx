-- Start the 15-day trial only AFTER the user confirms their email.
--
-- Previously `handle_new_user` ran on INSERT into auth.users, so a signup with a
-- fake/unconfirmed address immediately got a profile + a trial subscription for
-- every tool. With "Confirm email" enabled in Supabase Auth, we instead create
-- those rows at the moment the email is confirmed — so unverified fakes leave
-- nothing usable behind.
--
-- The function body is unchanged (profile + trial inserts, both idempotent via
-- `on conflict do nothing`); we add a guard and re-point the trigger.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Do nothing until the email is confirmed.
  if new.email_confirmed_at is null then
    return new;
  end if;

  -- On UPDATE, only act on the confirmation transition (null -> not null),
  -- not on later updates to an already-confirmed user.
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;

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

-- Re-point the trigger: fire on INSERT (covers admin-created / already-confirmed
-- users) and on the email_confirmed_at change (normal signup confirmation flow).
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_new_user();
