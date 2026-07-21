-- One-row snapshot of the whole estate: what came in, where it went, what is
-- still owed to the heirs, and what expenses are still pending (not yet
-- charged to any income).
with gross as (
    select coalesce(sum(gross_cents), 0) as gross_received_cents
    from {{ ref('stg_receitas') }}
),

shares as (
    select
        coalesce(sum(case when kind = 'LAWYER_FEE' then amount_cents else 0 end), 0) as lawyer_fees_cents,
        coalesce(sum(case when kind = 'HEIR_SHARE' then amount_cents else 0 end), 0) as heirs_owed_cents
    from {{ ref('stg_shares') }}
),

paid as (
    select coalesce(sum(amount_cents), 0) as heirs_paid_cents
    from {{ ref('stg_repasses') }}
),

expenses as (
    select
        coalesce(sum(case when receita_id is not null then amount_cents else 0 end), 0) as expenses_paid_cents,
        coalesce(sum(case when receita_id is null then amount_cents else 0 end), 0)     as expenses_pending_cents
    from {{ ref('stg_despesas') }}
)

select
    g.gross_received_cents,
    s.lawyer_fees_cents,
    e.expenses_paid_cents,
    s.heirs_owed_cents,
    p.heirs_paid_cents,
    s.heirs_owed_cents - p.heirs_paid_cents as heirs_outstanding_cents,
    e.expenses_pending_cents
from gross g, shares s, paid p, expenses e
