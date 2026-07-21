-- Estate expenses. A row with a receita_id was absorbed into that income's
-- split (deducted before dividing); a null receita_id is still pending.
select
    "id"          as despesa_id,
    "descricao"   as description,
    "amountCents" as amount_cents,
    "dueAt"       as due_at,
    "receitaId"   as receita_id
from {{ source('raw', 'inventario_despesas') }}
