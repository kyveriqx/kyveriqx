-- Kyveriqx — lock admin access to a single account: kyveriqx@gmail.com.
--
-- Supersedes the chandrakant.kant26@gmail.com seed in 0008 and any ad-hoc
-- promotions (e.g. the "promote oldest auth user" one-off). The two statements
-- run together: first revoke admin from EVERYONE, then grant it to exactly one
-- email. Order matters — revoke-all then grant-one guarantees a single admin
-- regardless of prior state. Idempotent: safe to re-run.
--
-- Note: the grant updates 0 rows if kyveriqx@gmail.com has no profile yet (i.e.
-- that account hasn't signed up / confirmed email). If so, register that
-- account first, then re-run the grant statement.

update public.profiles set is_admin = false where is_admin = true;

update public.profiles set is_admin = true  where email = 'kyveriqx@gmail.com';
