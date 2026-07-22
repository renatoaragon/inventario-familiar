-- Payouts actually made to a member (against a receita, or general).
select
    "id"          as repasse_id,
    "memberId"    as member_id,
    "receitaId"   as receita_id,
    "amountCents" as amount_cents,
    "paidAt"      as paid_at
from {{ source('raw', 'inventario_repasses') }}
