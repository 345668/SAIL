-- The plan catalogue designed in docs/architecture/42 (persona-aware, priced in EUR). Additive; the 2026-10-04c placeholder plans are retired, not deleted.
ALTER TABLE plan_catalog ADD COLUMN IF NOT EXISTS persona text;
ALTER TABLE plan_catalog ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE plan_catalog ADD COLUMN IF NOT EXISTS price_eur_month integer;
ALTER TABLE plan_catalog ADD COLUMN IF NOT EXISTS price_eur_year integer;
ALTER TABLE plan_catalog ADD COLUMN IF NOT EXISTS summary text;

UPDATE plan_catalog SET status = 'retired', summary = 'Placeholder from the first design; retired.' WHERE plan IN ('starter', 'pro', 'scale');

INSERT INTO plan_catalog (plan, label, persona, status, price_eur_month, price_eur_year, summary, features, limits, sort) VALUES
 ('founder_explore', 'Founder Explore', 'founder', 'active', 0, 0, 'Free: look around, run a match, try the assistant. The way founders find Anker and, through intake, the way funds find founders.',
   '{"assistant":true,"outreach":false,"linkedin":false,"matchmaking":true,"intake":false,"tools":true,"fund_ops":false,"spvs":false,"deals":false}'::jsonb,
   '{"ai_spend_usd_month":3,"seats":1,"outreach_sends_day":0,"intake_submissions_month":0,"storage_mb":200}'::jsonb, 10),
 ('founder_raise', 'Founder Raise', 'founder', 'active', 149, 1490, 'Run a raise: matching, approval-gated outreach, the assistant and the tools.',
   '{"assistant":true,"outreach":true,"linkedin":false,"matchmaking":true,"intake":false,"tools":true,"fund_ops":false,"spvs":false,"deals":false}'::jsonb,
   '{"ai_spend_usd_month":30,"seats":3,"outreach_sends_day":50,"intake_submissions_month":0,"storage_mb":2000}'::jsonb, 11),
 ('founder_raise_plus', 'Founder Raise+', 'founder', 'active', 349, 3490, 'A larger raise or a small team: LinkedIn campaigns and more sending.',
   '{"assistant":true,"outreach":true,"linkedin":true,"matchmaking":true,"intake":false,"tools":true,"fund_ops":false,"spvs":false,"deals":false}'::jsonb,
   '{"ai_spend_usd_month":90,"seats":8,"outreach_sends_day":150,"intake_submissions_month":0,"storage_mb":10000}'::jsonb, 12),
 ('fund_studio', 'Fund Studio', 'vc', 'active', 390, 3900, 'An emerging manager or studio: inbound intake with the engine, deal pipeline, LP and founder outreach, the assistant.',
   '{"assistant":true,"outreach":true,"linkedin":false,"matchmaking":true,"intake":true,"tools":true,"fund_ops":false,"spvs":false,"deals":true}'::jsonb,
   '{"ai_spend_usd_month":60,"seats":5,"outreach_sends_day":100,"intake_submissions_month":150,"storage_mb":10000}'::jsonb, 20),
 ('fund_pro', 'Fund Pro', 'vc', 'active', 990, 9900, 'Run the fund: everything in Studio plus fund administration (ledger, capital calls, LP reporting, compliance, KYC) and LinkedIn.',
   '{"assistant":true,"outreach":true,"linkedin":true,"matchmaking":true,"intake":true,"tools":true,"fund_ops":true,"spvs":false,"deals":true}'::jsonb,
   '{"ai_spend_usd_month":200,"seats":15,"outreach_sends_day":300,"intake_submissions_month":600,"storage_mb":50000}'::jsonb, 21),
 ('fund_institutional', 'Fund Institutional', 'vc', 'active', NULL, NULL, 'Larger managers: SPVs, high limits, security review, a named contact. Priced per contract (from about EUR 2,500 a month, annual).',
   '{"assistant":true,"outreach":true,"linkedin":true,"matchmaking":true,"intake":true,"tools":true,"fund_ops":true,"spvs":true,"deals":true}'::jsonb,
   '{"ai_spend_usd_month":800,"seats":50,"outreach_sends_day":1000,"intake_submissions_month":3000,"storage_mb":250000}'::jsonb, 22),
 ('lp_access', 'LP access', 'lp', 'active', 0, 0, 'Free for limited partners, paid for by the fund whose LP they are.',
   '{"assistant":false,"outreach":false,"linkedin":false,"matchmaking":false,"intake":false,"tools":true,"fund_ops":false,"spvs":false,"deals":false}'::jsonb,
   '{"ai_spend_usd_month":0,"seats":1,"storage_mb":200}'::jsonb, 30),
 ('design_partner', 'Design partner', NULL, 'active', 0, 0, 'Everything a fund gets, free for six months, in return for weekly feedback and a named case study. Converts to Fund Studio or Pro.',
   '{"assistant":true,"outreach":true,"linkedin":true,"matchmaking":true,"intake":true,"tools":true,"fund_ops":true,"spvs":false,"deals":true}'::jsonb,
   '{"ai_spend_usd_month":200,"seats":15,"outreach_sends_day":300,"intake_submissions_month":600,"storage_mb":50000}'::jsonb, 40)
ON CONFLICT (plan) DO UPDATE SET label = EXCLUDED.label, persona = EXCLUDED.persona, status = EXCLUDED.status, price_eur_month = EXCLUDED.price_eur_month,
  price_eur_year = EXCLUDED.price_eur_year, summary = EXCLUDED.summary, features = EXCLUDED.features, limits = EXCLUDED.limits, sort = EXCLUDED.sort, updated_at = now();

-- Internal gains the new module key and keeps everything on.
UPDATE plan_catalog SET features = features || '{"deals":true}'::jsonb WHERE plan = 'internal';
