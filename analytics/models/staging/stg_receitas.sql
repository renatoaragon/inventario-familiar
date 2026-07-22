-- Income entries, one row per receita. Amounts stay in cents (integer) to
-- keep the reconciliation exact; formatting to reais is a presentation concern.
select
    "id"                                     as receita_id,
    "descricao"                              as description,
    "grossCents"                             as gross_cents,
    "receivedAt"                             as received_at,
    cast(date_trunc('month', "receivedAt") as date) as received_month
from {{ source('raw', 'inventario_receitas') }}
