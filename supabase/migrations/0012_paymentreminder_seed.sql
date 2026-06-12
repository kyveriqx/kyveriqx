-- Kyveriqx — Customer Payment Reminder tool: seed catalogue row + the
-- customer-list upload bucket.
--
-- This tool is a sibling of emailcampaign (one folder per tool, per the golden
-- rule in 0001_init.sql): /tools/paymentreminder/ sends a templated reminder —
-- with {{name}} {{amount}} {{balance}} {{invoice_number}} {{invoice_details}}
-- {{due_date}} merge fields — to a CSV/Excel customer list via the user's own
-- mailbox.
--
-- Deliberately REUSED from emailcampaign (no new tables here):
--   * user_smtp_credentials / user_mail_oauth — the mailbox connection is
--     keyed by user, so a customer connects once and both tools send from it.
--   * emailcampaign_approvals — sender approval is shared; anyone approved to
--     send email campaigns is approved to send reminders too.

-- ---------- catalogue row ---------------------------------------------------

insert into public.tools (slug, subdomain, name, description, price) values
  ('paymentreminder', 'paymentreminder', 'Customer Payment Reminder',
   'Send personalised payment reminders to your customers/debtors from your own mailbox.',
   99)
on conflict (slug) do nothing;

-- Backfill: every existing user gets a 15-day trial on this new tool, same as
-- if they had just signed up. Matches the trigger logic in 0006_trial_15_days.sql.
insert into public.subscriptions (user_id, tool_id, status, trial_started_at, trial_ends_at)
select u.id, t.id, 'trial', now(), now() + interval '15 days'
from auth.users u
cross join public.tools t
where t.slug = 'paymentreminder'
on conflict (user_id, tool_id) do nothing;

-- ---------- storage bucket for customer-list uploads -----------------------

-- Path layout (mirrors emailcampaign-uploads in 0007_emailcampaign.sql):
--   paymentreminder-uploads/<auth.uid>/<upload-id>-recipients-<filename>

insert into storage.buckets (id, name, public)
values ('paymentreminder-uploads', 'paymentreminder-uploads', false)
on conflict (id) do nothing;

drop policy if exists "paymentreminder_uploads_select_own" on storage.objects;
create policy "paymentreminder_uploads_select_own"
  on storage.objects for select
  using (
    bucket_id = 'paymentreminder-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "paymentreminder_uploads_insert_own" on storage.objects;
create policy "paymentreminder_uploads_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'paymentreminder-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "paymentreminder_uploads_delete_own" on storage.objects;
create policy "paymentreminder_uploads_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'paymentreminder-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
