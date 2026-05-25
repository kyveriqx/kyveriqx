-- Test-mode pricing — every tool at ₹1/month so we can click through the
-- Razorpay test flow without spending real money. Revert before going live
-- by re-running the prices from migration 0001.

update public.tools set price = 1 where slug in (
  'gstledgerreco',
  'bankledgerreco',
  'orgledgerreco',
  'custportal',
  'callingtool',
  'whatsappcampaign'
);
