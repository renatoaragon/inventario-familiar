-- The estate's headline guarantee, as a test: not one cent may go unaccounted.
-- Every receita's gross must equal its shares (heir quinhões + lawyer fee)
-- plus the expenses charged to it. Any row here is a real discrepancy and
-- fails the build.
select
    receita_id,
    gross_cents,
    shares_cents,
    expenses_cents,
    unaccounted_cents
from {{ ref('mart_reconciliation') }}
where unaccounted_cents <> 0
