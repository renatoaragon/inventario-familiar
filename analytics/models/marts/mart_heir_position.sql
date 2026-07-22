-- Where each heir stands: total owed across all receitas (their HEIR_SHARE
-- quinhões) against what has actually been paid out, and the outstanding
-- balance. This is the "am I square with the estate?" view, per person.
with heirs as (
    select member_id, name
    from {{ ref('stg_members') }}
    where role = 'HEIR' and active
),

owed as (
    select member_id, sum(amount_cents) as owed_cents
    from {{ ref('stg_shares') }}
    where kind = 'HEIR_SHARE'
    group by 1
),

paid as (
    select member_id, sum(amount_cents) as paid_cents
    from {{ ref('stg_repasses') }}
    group by 1
)

select
    h.member_id,
    h.name,
    coalesce(o.owed_cents, 0)                          as owed_cents,
    coalesce(p.paid_cents, 0)                          as paid_cents,
    coalesce(o.owed_cents, 0) - coalesce(p.paid_cents, 0) as outstanding_cents
from heirs h
left join owed o on o.member_id = h.member_id
left join paid p on p.member_id = h.member_id
order by outstanding_cents desc, h.name
