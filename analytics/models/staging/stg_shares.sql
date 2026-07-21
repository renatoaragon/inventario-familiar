-- Immutable split lines per receita: one LAWYER_FEE and one HEIR_SHARE per
-- active heir. Their sum is what must add back up to the gross.
select
    "id"          as share_id,
    "receitaId"   as receita_id,
    "memberId"    as member_id,
    "kind"        as kind,          -- HEIR_SHARE | LAWYER_FEE
    "amountCents" as amount_cents
from {{ source('raw', 'inventario_shares') }}
