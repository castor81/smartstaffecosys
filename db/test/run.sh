#!/usr/bin/env bash
# Runs schema, seed, API and tests on a throwaway PostgreSQL cluster. Usage: bash db/test/run.sh
set -euo pipefail
B=${PGBIN:-/usr/lib/postgresql/16/bin}
HERE=$(cd "$(dirname "$0")" && pwd)
D=$(mktemp -d); chmod 755 "$D"
if [ "$(id -u)" = 0 ]; then chown postgres "$D"; R="runuser -u postgres --"; else R=""; fi
$R "$B/initdb" -D "$D/data" -U postgres >/dev/null
$R "$B/pg_ctl" -D "$D/data" -o "-k $D -p 55432 -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '$R "$B/pg_ctl" -D "$D/data" stop >/dev/null' EXIT
run() { echo "== ${1##*/}"; psql -q -h "$D" -p 55432 -U postgres -d "$2" -v ON_ERROR_STOP=1 -f - < "$1" 2>&1; }
for db in schema_test api_test; do
  psql -q -h "$D" -p 55432 -U postgres -c "create database $db"
  run "$HERE/supabase_stub.sql" $db
  run "$HERE"/../sse_schema_*.sql $db
  run "$HERE"/../sse_gate_seed_*.sql $db
  run "$HERE"/../sse_api_*.sql $db
  run "$HERE/test_${db%_test}.sql" $db
done

# Workflow data flow: demo headquarters + the node scripts against the same functions.
db=e2e_test
psql -q -h "$D" -p 55432 -U postgres -c "create database $db"
for f in "$HERE/supabase_stub.sql" "$HERE"/../sse_schema_*.sql "$HERE"/../sse_gate_seed_*.sql "$HERE"/../sse_api_*.sql; do run "$f" $db; done
psql -q -h "$D" -p 55432 -U postgres -d $db -v ON_ERROR_STOP=1 \
  -c "insert into auth.users (id, email) values (gen_random_uuid(), 'you@example.com')"
run "$HERE"/../sse_demo_setup_*.sql $db
echo "== e2e_workflow.mjs"
node "$HERE/e2e_workflow.mjs" "$D" 55432 $db
