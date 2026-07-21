-- The estate's conservation law, one row per receita: the gross that came in
-- must equal every cent that left it -- the heir quinhões, the lawyer fee
-- (both are shares) and the expenses charged to that receita. If
-- unaccounted_cents is anything but zero, money was created or lost.
--
-- Shares and expenses are each summed to one row per receita *before* the
-- join, so neither fans the other out.
with receitas as (
    select * from {{ ref('stg_receitas') }}
),

shares as (
    select receita_id, sum(amount_cents) as shares_cents
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
    r.receita_id,
    r.received_month,
    r.gross_cents,
    coalesce(s.shares_cents, 0)   as shares_cents,
    coalesce(d.expenses_cents, 0) as expenses_cents,
    r.gross_cents
        - coalesce(s.shares_cents, 0)
        - coalesce(d.expenses_cents, 0) as unaccounted_cents
from receitas r
left join shares s on s.receita_id = r.receita_id
left join despesas d on d.receita_id = r.receita_id
order by r.received_month, r.receita_id
