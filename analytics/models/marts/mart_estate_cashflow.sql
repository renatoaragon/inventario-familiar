-- Monthly cash flow of the estate: for each month income was received, how
-- the gross broke down into the lawyer's fee, the expenses taken off the top,
-- and the net distributed to the heirs.
with receitas as (
    select * from {{ ref('stg_receitas') }}
),

shares as (
    select
        receita_id,
        sum(case when kind = 'LAWYER_FEE' then amount_cents else 0 end) as lawyer_cents,
        sum(case when kind = 'HEIR_SHARE' then amount_cents else 0 end) as heir_cents
    from {{ ref('stg_shares') }}
    group by 1
),

despesas as (
    select receita_id, sum(amount_cents) as expenses_cents
    from {{ ref('stg_despesas') }}
    where receita_id is not null
    group by 1
)

select
    r.received_month                          as month,
    count(*)                                  as receitas,
    sum(r.gross_cents)                        as gross_cents,
    sum(coalesce(s.lawyer_cents, 0))          as lawyer_fee_cents,
    sum(coalesce(d.expenses_cents, 0))        as expenses_cents,
    sum(coalesce(s.heir_cents, 0))            as heirs_distributed_cents
from receitas r
left join shares s on s.receita_id = r.receita_id
left join despesas d on d.receita_id = r.receita_id
group by 1
order by 1
