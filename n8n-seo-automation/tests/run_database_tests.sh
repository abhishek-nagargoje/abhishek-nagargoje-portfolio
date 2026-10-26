#!/usr/bin/env bash
# Rebuilds a DISPOSABLE test database, applies database/01-04 twice (idempotency),
# runs tests/database_tests.sql and a parallel-claim concurrency test.
#
# Usage: PGDB=seo_test PSQL="psql -h localhost -U postgres" tests/run_database_tests.sh
# Never point PGDB at a production database: it is dropped and recreated.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PGDB="${PGDB:-seo_test}"
PSQL="${PSQL:-psql}"
DROPDB="${DROPDB:-dropdb}"
CREATEDB="${CREATEDB:-createdb}"

$DROPDB --if-exists "$PGDB"
$CREATEDB "$PGDB"

for pass in 1 2; do
  for f in 01_pgvector_setup.sql 02_brand_knowledge_schema.sql 03_article_processing_history.sql 04_idempotency_and_recovery.sql; do
    $PSQL -q -v ON_ERROR_STOP=1 -d "$PGDB" -f "$ROOT/database/$f" >/dev/null 2>&1 \
      || { echo "FAIL applying $f (pass $pass)"; $PSQL -v ON_ERROR_STOP=1 -d "$PGDB" -f "$ROOT/database/$f"; exit 1; }
  done
  echo "PASS schema applied (pass $pass)"
done

$PSQL -v ON_ERROR_STOP=1 -d "$PGDB" -f "$HERE/database_tests.sql" 2>&1 | grep -E "PASS|ERROR|PASSED"

# Concurrency: N sessions race to claim the same new keyword. Exactly one may win.
N=20
TMP="$(mktemp -d)"
for i in $(seq 1 $N); do
  ( $PSQL -tA -v ON_ERROR_STOP=1 -d "$PGDB" -c \
      "SET ROLE n8n_seo_app; SELECT outcome FROM seo.claim_keyword('KWRACE','TEST','https://example.com/race','https://example.com/race','race kw','race kw','race-exec-$i',180,false,3);" \
      > "$TMP/$i.out" 2>&1 ) &
done
wait
CLAIMED=$(cat "$TMP"/*.out | awk '$0=="CLAIMED"{n++} END{print n+0}')
INPROG=$(cat "$TMP"/*.out | awk '$0=="IN_PROGRESS"{n++} END{print n+0}')
ERRS=$(cat "$TMP"/*.out | awk 'tolower($0) ~ /error/{n++} END{print n+0}')
rm -rf "$TMP"
if [ "$CLAIMED" -eq 1 ] && [ "$INPROG" -eq $((N - 1)) ] && [ "$ERRS" -eq 0 ]; then
  echo "PASS CONCURRENCY $N parallel claims -> 1 CLAIMED, $INPROG IN_PROGRESS"
else
  echo "FAIL CONCURRENCY claimed=$CLAIMED in_progress=$INPROG errors=$ERRS"; exit 1
fi
