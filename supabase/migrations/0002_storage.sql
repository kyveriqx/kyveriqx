-- Kyveriqx — storage bucket for ledger uploads (Architecture §8.4).
-- A single private bucket scoped per-user via RLS. Path layout:
--   ledger-uploads/<auth.uid>/<upload-id>-<filename>
-- This way the policy can derive the owning user from the first path segment.

insert into storage.buckets (id, name, public)
values ('ledger-uploads', 'ledger-uploads', false)
on conflict (id) do nothing;

-- Owner = the user_id encoded as the first folder in storage_path.
-- (storage.foldername returns the path split into a text[] array.)

create policy "ledger_uploads_select_own"
  on storage.objects for select
  using (
    bucket_id = 'ledger-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "ledger_uploads_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'ledger-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "ledger_uploads_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'ledger-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
