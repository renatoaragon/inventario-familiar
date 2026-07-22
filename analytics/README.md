# Analytics (dbt + DuckDB)

An analytical layer over the app's Postgres database. DuckDB attaches Postgres
**read-only** and materializes the marts locally, so analytics never puts load
on the serving database.

The app's own tests cover the split *engine* (a pure function). This layer
answers the next question: once the money has moved through the tables, does it
still add up, and where does the estate stand?

## Models

| Model | What it answers |
|---|---|
| `mart_reconciliation` | Per receita: does gross equal shares + linked expenses? `unaccounted_cents` must be 0 |
| `mart_estate_cashflow` | Monthly breakdown: gross in, lawyer fee, expenses, net distributed |
| `mart_heir_position` | Per heir: total owed (quinhões) vs paid, and the outstanding balance |
| `mart_estate_health` | One-row snapshot: received, fees, expenses, owed, paid, pending |

## The reconciliation gate

The headline guarantee of the product is that the split never loses or invents
money. Here that stops being a claim and becomes a test:
[`tests/assert_estate_reconciles.sql`](tests/assert_estate_reconciles.sql)
fails the build if any receita's gross does not equal its shares (heir quinhões
plus lawyer fee) plus the expenses charged to it, down to the cent. It runs in
CI on every change, against a seeded Postgres.

## Running

```bash
pip install dbt-duckdb
cd analytics
cp profiles.yml.example profiles.yml   # fill in the Postgres connection
dbt deps
dbt build                              # run + test
```

Explore the results directly:

```bash
duckdb inventario.duckdb "select * from mart_heir_position"
```

> Amounts are kept in **cents** (integers) throughout, so the reconciliation is
> exact; converting to reais is left to whatever reads the marts.
