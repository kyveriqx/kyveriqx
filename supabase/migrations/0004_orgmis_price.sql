-- Drop the Org BOD MIS price from ₹499 to ₹99 / month.
update public.tools set price = 99 where slug = 'orgmis';
