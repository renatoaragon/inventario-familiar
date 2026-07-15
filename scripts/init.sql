-- Inventário Familiar: schema (idempotent).
--
-- Plain SQL by design: the app reads/writes through Prisma models mapped to
-- these tables, but the schema itself is owned by this script so it works on
-- any Postgres without migrations tooling. Re-run it safely at any time.
--
-- Apply (wherever DATABASE_URL points):
--   npm run db:init
-- Optionally load the fictional demo data afterwards:
--   npm run db:seed-demo

CREATE TABLE IF NOT EXISTS "inventario_members" (
  "id"           TEXT PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "phone"        TEXT NOT NULL UNIQUE,          -- digits only, with country code: 5511987654321
  "role"         TEXT NOT NULL DEFAULT 'HEIR',  -- HEIR | LAWYER
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "passwordHash" TEXT,                          -- null = first access pending (one-time code)
  "blocked"      BOOLEAN NOT NULL DEFAULT false,-- blocked by an admin password reset
  "sessionEpoch" INTEGER NOT NULL DEFAULT 0,    -- bump revokes every session
  "pixKey"       TEXT,                          -- payment key (null = pending)
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "inventario_otps" (
  "id"         TEXT PRIMARY KEY,
  "memberId"   TEXT NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventario_otps_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "inventario_members" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "inventario_otps_memberId_idx" ON "inventario_otps" ("memberId");

CREATE TABLE IF NOT EXISTS "inventario_documents" (
  "id"             TEXT PRIMARY KEY,
  "filename"       TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "size"           INTEGER NOT NULL DEFAULT 0,
  "s3Key"          TEXT,
  "data"           TEXT,                     -- base64 (fallback when S3 is not configured)
  "uploadedById"   TEXT,                     -- null = admin
  "uploadedByName" TEXT NOT NULL DEFAULT 'Admin',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "inventario_documents_createdAt_idx" ON "inventario_documents" ("createdAt");

CREATE TABLE IF NOT EXISTS "inventario_receitas" (
  "id"         TEXT PRIMARY KEY,
  "descricao"  TEXT NOT NULL,
  "grossCents" INTEGER NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "inventario_receitas_receivedAt_idx" ON "inventario_receitas" ("receivedAt");

-- Shares are computed when the income entry is created: lawyer fee plus one
-- row per heir. Immutable history by design.
CREATE TABLE IF NOT EXISTS "inventario_shares" (
  "id"          TEXT PRIMARY KEY,
  "receitaId"   TEXT NOT NULL,
  "memberId"    TEXT NOT NULL,
  "kind"        TEXT NOT NULL,               -- HEIR_SHARE | LAWYER_FEE
  "amountCents" INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventario_shares_receitaId_fkey"
    FOREIGN KEY ("receitaId") REFERENCES "inventario_receitas" ("id") ON DELETE CASCADE,
  CONSTRAINT "inventario_shares_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "inventario_members" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "inventario_shares_receitaId_idx" ON "inventario_shares" ("receitaId");
CREATE INDEX IF NOT EXISTS "inventario_shares_memberId_idx" ON "inventario_shares" ("memberId");

CREATE TABLE IF NOT EXISTS "inventario_repasses" (
  "id"          TEXT PRIMARY KEY,
  "memberId"    TEXT NOT NULL,
  "receitaId"   TEXT,
  "amountCents" INTEGER NOT NULL,
  "paidAt"      TIMESTAMP(3) NOT NULL,
  "nota"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventario_repasses_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "inventario_members" ("id") ON DELETE CASCADE,
  CONSTRAINT "inventario_repasses_receitaId_fkey"
    FOREIGN KEY ("receitaId") REFERENCES "inventario_receitas" ("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "inventario_repasses_memberId_idx" ON "inventario_repasses" ("memberId");

-- Expenses are deducted from the income entry of the month they are due,
-- the same way the lawyer fee is.
CREATE TABLE IF NOT EXISTS "inventario_despesas" (
  "id"          TEXT PRIMARY KEY,
  "descricao"   TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "dueAt"       TIMESTAMP(3) NOT NULL,
  "receitaId"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventario_despesas_receitaId_fkey"
    FOREIGN KEY ("receitaId") REFERENCES "inventario_receitas" ("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "inventario_despesas_dueAt_idx" ON "inventario_despesas" ("dueAt");
CREATE INDEX IF NOT EXISTS "inventario_despesas_receitaId_idx" ON "inventario_despesas" ("receitaId");

CREATE TABLE IF NOT EXISTS "inventario_access_log" (
  "id"        TEXT PRIMARY KEY,
  "memberId"  TEXT,                          -- null = admin
  "actor"     TEXT NOT NULL,
  "action"    TEXT NOT NULL,                 -- CODE_SENT | LOGIN_OK | LOGIN_FAIL | DOC_UPLOAD | ...
  "detail"    TEXT,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "inventario_access_log_createdAt_idx" ON "inventario_access_log" ("createdAt");
