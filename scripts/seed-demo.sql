-- Fictional demo data (idempotent). All names, phones and amounts are made up.
-- Pick one heir as admin by setting INVENTARIO_ADMIN_PHONE to their phone
-- (Alex below, in .env.example).
--
-- The receitas/shares/despesas below follow the app's own split rule
-- (5% lawyer fee, month's expenses off the top, net divided equally with the
-- leftover cent going to the first heirs), so the analytics reconciliation
-- test has real, balanced data to run against.
INSERT INTO "inventario_members" ("id", "name", "phone", "role") VALUES
  ('mem_alex',  'Alex',  '5511999990001', 'HEIR'),
  ('mem_bruna', 'Bruna', '5511999990002', 'HEIR'),
  ('mem_caio',  'Caio',  '5511999990003', 'HEIR'),
  ('mem_duda',  'Duda',  '5511999990004', 'HEIR'),
  ('mem_livia', 'Livia', '5511999990005', 'LAWYER')
ON CONFLICT ("phone") DO NOTHING;

-- Receitas (income): gross amounts in cents.
INSERT INTO "inventario_receitas" ("id", "descricao", "grossCents", "receivedAt") VALUES
  ('rec_1', 'Parcela 1 da venda do imóvel', 400000, '2026-03-10 12:00:00'),
  ('rec_2', 'Parcela 2 da venda do imóvel', 250000, '2026-04-05 12:00:00'),
  ('rec_3', 'Parcela 3 da venda do imóvel', 333333, '2026-05-12 12:00:00')
ON CONFLICT ("id") DO NOTHING;

-- Expenses charged to a receita's month (deducted before the split).
INSERT INTO "inventario_despesas" ("id", "descricao", "amountCents", "dueAt", "receitaId") VALUES
  ('desp_1', 'Custas do inventário', 30000, '2026-04-20 12:00:00', 'rec_2'),
  ('desp_2', 'Certidão pendente',     15000, '2026-06-10 12:00:00', NULL)  -- not yet absorbed
ON CONFLICT ("id") DO NOTHING;

-- Shares per receita: LAWYER_FEE (5% of gross) + one HEIR_SHARE per active heir.
-- rec_1: fee 20000; net 380000 / 4 = 95000 each.
-- rec_2: fee 12500; (250000 - 12500 - 30000 expense) = 207500 / 4 = 51875 each.
-- rec_3: fee 16667; net 316666 / 4 = 79166, leftover 2c to the first two heirs.
INSERT INTO "inventario_shares" ("id", "receitaId", "memberId", "kind", "amountCents") VALUES
  ('sh_1_fee',  'rec_1', 'mem_livia', 'LAWYER_FEE', 20000),
  ('sh_1_alex', 'rec_1', 'mem_alex',  'HEIR_SHARE', 95000),
  ('sh_1_bru',  'rec_1', 'mem_bruna', 'HEIR_SHARE', 95000),
  ('sh_1_cai',  'rec_1', 'mem_caio',  'HEIR_SHARE', 95000),
  ('sh_1_dud',  'rec_1', 'mem_duda',  'HEIR_SHARE', 95000),
  ('sh_2_fee',  'rec_2', 'mem_livia', 'LAWYER_FEE', 12500),
  ('sh_2_alex', 'rec_2', 'mem_alex',  'HEIR_SHARE', 51875),
  ('sh_2_bru',  'rec_2', 'mem_bruna', 'HEIR_SHARE', 51875),
  ('sh_2_cai',  'rec_2', 'mem_caio',  'HEIR_SHARE', 51875),
  ('sh_2_dud',  'rec_2', 'mem_duda',  'HEIR_SHARE', 51875),
  ('sh_3_fee',  'rec_3', 'mem_livia', 'LAWYER_FEE', 16667),
  ('sh_3_alex', 'rec_3', 'mem_alex',  'HEIR_SHARE', 79167),
  ('sh_3_bru',  'rec_3', 'mem_bruna', 'HEIR_SHARE', 79167),
  ('sh_3_cai',  'rec_3', 'mem_caio',  'HEIR_SHARE', 79166),
  ('sh_3_dud',  'rec_3', 'mem_duda',  'HEIR_SHARE', 79166)
ON CONFLICT ("id") DO NOTHING;

-- Payouts (repasses): some heirs already paid, leaving outstanding balances.
INSERT INTO "inventario_repasses" ("id", "memberId", "receitaId", "amountCents", "paidAt") VALUES
  ('rep_1', 'mem_alex',  'rec_1', 95000, '2026-03-15 12:00:00'),
  ('rep_2', 'mem_bruna', 'rec_1', 95000, '2026-03-16 12:00:00'),
  ('rep_3', 'mem_alex',  'rec_2', 51875, '2026-04-25 12:00:00')
ON CONFLICT ("id") DO NOTHING;
