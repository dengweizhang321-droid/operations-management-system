# AI v4 replay READ return type repair

Migration `0050_business_v4_replay_read_cast` repairs the 0047 replay READ
function. The receipt table stores `candidate_digest` as `varchar(64)`, while
the function declares that result column as `text`. PostgreSQL `RETURN QUERY`
requires an explicit cast for this return shape. The replacement adds only
`p.candidate_digest::text` to the projection.

Before replacement, the migration checks the exact 0047 READ body, its result
signature, SECURITY DEFINER settings, owner, NOLOGIN role, function and table
privileges, PUBLIC EXECUTE revocation, and direct seal denial. `CREATE OR
REPLACE` retains the function identity and ACL. The claim checks before and
after the SELECT and the 0048 replay writer are unchanged.

Reverse migration restores the frozen 0047 body only when the replay receipt
table is empty. Once any candidate has been recorded, reverse migration fails
closed because restoring the old body would make that receipt unreadable. The
target PostgreSQL test records real promotion and finance candidates using the
sealer role, reads them under the matching claim, rejects a wrong claim, and covers
function body drift and both reverse-migration boundaries. Production upgrade
and rollback rehearsal remain separate gates.
