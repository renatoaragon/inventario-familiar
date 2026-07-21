-- Estate members. Names are not needed for the money maths, but the role
-- (HEIR vs LAWYER) and active flag are.
select
    "id"     as member_id,
    "name"   as name,
    "role"   as role,       -- HEIR | LAWYER
    "active" as active
from {{ source('raw', 'inventario_members') }}
