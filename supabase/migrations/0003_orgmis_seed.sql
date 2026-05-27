-- Management / BOD MIS Generator — tool seed + storage buckets.
-- Adds the new tool to the catalogue (so it appears on /store and grants
-- 14-day trials to all users via the existing handle_new_user trigger)
-- and creates the two private Storage buckets it uses.

-- 1. Tool catalogue row -------------------------------------------------------

insert into public.tools (slug, subdomain, name, description, price) values
  (
    'orgmis',
    'orgmis',
    'Management / BOD MIS Generator',
    'Branded board MIS, deck, and PDF.',
    99
  )
on conflict (slug) do nothing;

-- Grant trial subs to existing users for the new tool (the handle_new_user
-- trigger covers future signups automatically).
insert into public.subscriptions (user_id, tool_id, status, trial_started_at, trial_ends_at)
  select u.id, t.id, 'trial', now(), now() + interval '14 days'
  from auth.users u
  cross join public.tools t
  where t.slug = 'orgmis'
on conflict (user_id, tool_id) do nothing;

-- 2. Storage buckets ----------------------------------------------------------
-- Both private. Uploads are written + read by the service-role client
-- inside /api/orgmis/upload + /api/orgmis/preview + the Trigger.dev task.
-- No storage.objects RLS policies needed because nothing browses these
-- buckets directly with the user's JWT.

insert into storage.buckets (id, name, public)
values ('orgmis-uploads', 'orgmis-uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('orgmis-outputs', 'orgmis-outputs', false)
on conflict (id) do nothing;
