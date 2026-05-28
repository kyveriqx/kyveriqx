-- Restore real per-tool pricing for go-live, undoing the ₹1 test override
-- from 0002_test_prices.sql. Values match the original seed in 0001_init.sql.
--
-- tools.price is the single source of truth: it drives both the price shown on
-- the billing page AND the amount each Razorpay Plan is created at
-- (scripts/create-razorpay-plans.ts reads these values). Change a price here
-- and re-run that script to mint a matching plan.

update public.tools set price = 99  where slug in ('gstledgerreco', 'bankledgerreco', 'orgledgerreco');
update public.tools set price = 199 where slug in ('custportal', 'callingtool', 'whatsappcampaign');
