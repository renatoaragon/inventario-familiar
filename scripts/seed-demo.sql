-- Fictional demo members (idempotent: never recreates or overwrites).
-- All names and phone numbers are made up. Pick one heir as admin by setting
-- INVENTARIO_ADMIN_PHONE to their phone (Alex below, in .env.example).
INSERT INTO "inventario_members" ("id", "name", "phone", "role") VALUES
  ('mem_alex',  'Alex',  '5511999990001', 'HEIR'),
  ('mem_bruna', 'Bruna', '5511999990002', 'HEIR'),
  ('mem_caio',  'Caio',  '5511999990003', 'HEIR'),
  ('mem_duda',  'Duda',  '5511999990004', 'HEIR'),
  ('mem_livia', 'Livia', '5511999990005', 'LAWYER')
ON CONFLICT ("phone") DO NOTHING;
