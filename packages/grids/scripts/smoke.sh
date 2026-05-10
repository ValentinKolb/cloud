#!/usr/bin/env bash
# Grids API smoke tests against a running local dev stack.
#
# What this exercises:
#   - admin-login → session token
#   - the wire paths most likely to surface migration / live-parent
#     bugs (the "column ambiguous" we hit, the slug NOT-NULL+CHECK,
#     the parent-liveness JOINs)
#   - relation field create → record write → relation hydration on
#     read (Wave 1.3 transactional paths)
#   - field delete with view-config cleanup (Wave 4.6 + final-review
#     fix)
#   - permission edge cases (Wave 2.1/2.2/2.3)
#
# Each step prints PASS / FAIL with a one-line context. Set DEBUG=1
# to also dump response bodies.
#
# Usage:
#   bun run scripts/smoke.sh
#   DEBUG=1 bun run scripts/smoke.sh
#   BASE_URL=http://localhost:3001 bun run scripts/smoke.sh

set -u  # unset-var = bug

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin}"
DEBUG="${DEBUG:-0}"

# Colour the output a little so failures pop in long logs. NO_COLOR
# turns it off (e.g. for CI logs).
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_PASS=$'\033[32m'
  C_FAIL=$'\033[31m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
else
  C_PASS=""; C_FAIL=""; C_DIM=""; C_RESET=""
fi

PASS=0
FAIL=0
RESPONSE_BODY=""
RESPONSE_STATUS=""

# Run a curl request. Captures status + body separately so callers can
# assert on both. The body is read with -o so binary content (audit
# pages with real diffs) doesn't break terminal mode.
http() {
  local method="$1" path="$2" body="${3:-}" extra="${4:-}"
  local tmp
  tmp=$(mktemp)
  if [[ -n "$body" ]]; then
    RESPONSE_STATUS=$(
      curl -s -o "$tmp" -w "%{http_code}" \
        -X "$method" "$BASE_URL$path" \
        -H "Authorization: Bearer ${SESSION:-no-session}" \
        -H "Content-Type: application/json" \
        $extra \
        --data "$body"
    )
  else
    RESPONSE_STATUS=$(
      curl -s -o "$tmp" -w "%{http_code}" \
        -X "$method" "$BASE_URL$path" \
        -H "Authorization: Bearer ${SESSION:-no-session}" \
        $extra
    )
  fi
  RESPONSE_BODY=$(cat "$tmp")
  rm -f "$tmp"
  [[ "$DEBUG" == "1" ]] && echo "  ${C_DIM}$method $path → $RESPONSE_STATUS${C_RESET}" >&2 \
    && echo "  ${C_DIM}↳ ${RESPONSE_BODY:0:200}${C_RESET}" >&2
}

# pass <name> ; fail <name> <reason>
pass() { PASS=$((PASS+1)); echo "${C_PASS}✓${C_RESET} $1"; }
fail() {
  FAIL=$((FAIL+1))
  echo "${C_FAIL}✗${C_RESET} $1"
  echo "  ${C_FAIL}reason:${C_RESET} $2"
  echo "  ${C_FAIL}status:${C_RESET} $RESPONSE_STATUS"
  echo "  ${C_FAIL}body:${C_RESET} ${RESPONSE_BODY:0:400}"
}

# Assert the last response status matches an expected code. On
# mismatch records a FAIL with the body so the user sees what came
# back instead of "expected 200 got 500" alone.
expect_status() {
  local expected="$1" name="$2"
  if [[ "$RESPONSE_STATUS" == "$expected" ]]; then
    pass "$name"
  else
    fail "$name" "expected $expected, got $RESPONSE_STATUS"
  fi
}

# Pick a JSON value out of the last response body. jq required.
json() { echo "$RESPONSE_BODY" | jq -r "$1"; }

# Cleanup helper: tries to delete a resource but doesn't fail the
# test run if the delete itself errors (the resource may already be
# gone, e.g. when a previous step failed before creating it).
cleanup_delete() {
  local path="$1"
  http DELETE "$path"
  [[ "$DEBUG" == "1" ]] && echo "  ${C_DIM}cleanup: $path → $RESPONSE_STATUS${C_RESET}" >&2 || true
}

# ────────────────────────────────────────────────────────────────────
# Setup: admin login
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ admin-login ━━━"
http POST /api/auth/admin-login "{\"token\":\"$ADMIN_TOKEN\"}"
if [[ "$RESPONSE_STATUS" != "200" ]]; then
  echo "${C_FAIL}admin-login failed; bailing.${C_RESET}"
  echo "status: $RESPONSE_STATUS"
  echo "body:   $RESPONSE_BODY"
  exit 1
fi
SESSION=$(json '.session_token')
[[ -z "$SESSION" || "$SESSION" == "null" ]] && { echo "no session_token"; exit 1; }
pass "admin-login → session"

# ────────────────────────────────────────────────────────────────────
# Setup: create a fresh base + table + fields for the run.
# Each run picks a unique suffix so reruns don't collide.
# ────────────────────────────────────────────────────────────────────

SUFFIX="$(date +%s)$RANDOM"
echo ""
echo "━━━ setup ━━━"

http POST /api/grids/bases "{\"name\":\"smoke-base-$SUFFIX\"}"
expect_status 201 "POST /api/grids/bases → 201"
BASE_ID=$(json '.id')
[[ -z "$BASE_ID" || "$BASE_ID" == "null" ]] && { echo "no base id"; exit 1; }

http POST /api/grids/tables/by-base/$BASE_ID "{\"name\":\"items\"}"
expect_status 201 "POST /api/grids/tables/by-base/:base → 201"
ITEMS_TABLE_ID=$(json '.id')

http POST /api/grids/tables/by-base/$BASE_ID "{\"name\":\"orders\"}"
expect_status 201 "POST /api/grids/tables/by-base/:base (second table) → 201"
ORDERS_TABLE_ID=$(json '.id')

# Add scalar fields on items: text + number.
http POST /api/grids/fields/by-table/$ITEMS_TABLE_ID '{"name":"name","type":"text","required":true}'
expect_status 201 "POST fields/items.name (text) → 201"
NAME_FIELD_ID=$(json '.id')

http POST /api/grids/fields/by-table/$ITEMS_TABLE_ID '{"name":"price","type":"number"}'
expect_status 201 "POST fields/items.price (number) → 201"
PRICE_FIELD_ID=$(json '.id')

# Relation field on orders → items.
http POST /api/grids/fields/by-table/$ORDERS_TABLE_ID "{\"name\":\"item\",\"type\":\"relation\",\"config\":{\"targetTableId\":\"$ITEMS_TABLE_ID\",\"cardinality\":\"single\"}}"
expect_status 201 "POST fields/orders.item (relation) → 201"
RELATION_FIELD_ID=$(json '.id')

# Cross-table rollup on orders → SUM(items.price). Exercises
# buildComputedProjections.resolveTargetField — the price field lives
# on a DIFFERENT table than the rollup, so the projection has to
# fetch it via getField() instead of finding it in the source-table
# field list. Pre-final-review this silently dropped the projection
# and rollups across relations returned NULL.
http POST /api/grids/fields/by-table/$ORDERS_TABLE_ID "{\"name\":\"item_price_sum\",\"type\":\"rollup\",\"config\":{\"relationFieldId\":\"$RELATION_FIELD_ID\",\"targetFieldId\":\"$PRICE_FIELD_ID\",\"agg\":\"sum\"}}"
expect_status 201 "POST fields/orders.item_price_sum (cross-table rollup) → 201"
ROLLUP_FIELD_ID=$(json '.id')

# ────────────────────────────────────────────────────────────────────
# Slug invariant (Wave 1.1): every entity got a 5-char alphanumeric slug.
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ slug invariant ━━━"

http GET /api/grids/bases/$BASE_ID
expect_status 200 "GET base"
SLUG=$(json '.slug')
[[ "$SLUG" =~ ^[A-Za-z0-9]{5}$ ]] && pass "base slug matches /^[A-Za-z0-9]{5}\$/" \
  || fail "base slug shape" "got '$SLUG'"

http GET /api/grids/tables/$ITEMS_TABLE_ID
TABLE_SLUG=$(json '.slug')
[[ "$TABLE_SLUG" =~ ^[A-Za-z0-9]{5}$ ]] && pass "table slug matches /^[A-Za-z0-9]{5}\$/" \
  || fail "table slug shape" "got '$TABLE_SLUG'"

# ────────────────────────────────────────────────────────────────────
# Cross-base relation rejection (Wave 5.2 critical)
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ cross-base relation rejected ━━━"

http POST /api/grids/bases '{"name":"smoke-other-base"}'
OTHER_BASE_ID=$(json '.id')
http POST /api/grids/tables/by-base/$OTHER_BASE_ID '{"name":"strangers"}'
OTHER_TABLE_ID=$(json '.id')

http POST /api/grids/fields/by-table/$ITEMS_TABLE_ID "{\"name\":\"bad\",\"type\":\"relation\",\"config\":{\"targetTableId\":\"$OTHER_TABLE_ID\",\"cardinality\":\"single\"}}"
expect_status 400 "POST cross-base relation → 400"

# Cleanup the other base — keeps the dev DB tidy across reruns.
cleanup_delete /api/grids/bases/$OTHER_BASE_ID

# ────────────────────────────────────────────────────────────────────
# Decimal config invariant (Wave 5.2): scale > precision rejected.
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ decimal config invariant ━━━"

http POST /api/grids/fields/by-table/$ITEMS_TABLE_ID '{"name":"badnum","type":"decimal","config":{"precision":5,"scale":10}}'
expect_status 400 "POST decimal scale>precision → 400"

# ────────────────────────────────────────────────────────────────────
# Record CRUD + transactional create + relation hydration (Wave 1.3)
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ records + relations ━━━"

http POST /api/grids/records/by-table/$ITEMS_TABLE_ID "{\"$NAME_FIELD_ID\":\"widget\",\"$PRICE_FIELD_ID\":99.99}"
expect_status 201 "POST item record → 201"
ITEM_REC_ID=$(json '.id')

http POST /api/grids/records/by-table/$ORDERS_TABLE_ID "{\"$RELATION_FIELD_ID\":[\"$ITEM_REC_ID\"]}"
expect_status 201 "POST order with relation link → 201"
ORDER_REC_ID=$(json '.id')

# Read it back through the unified query endpoint — exercises records.list
# + record_links hydration + the live-parent JOINs.
http POST /api/grids/tables/$ORDERS_TABLE_ID/query '{"query":{}}'
expect_status 200 "POST tables/:id/query (orders) → 200"
HYDRATED=$(json ".items[] | select(.id==\"$ORDER_REC_ID\") | .data[\"$RELATION_FIELD_ID\"][0]")
[[ "$HYDRATED" == "$ITEM_REC_ID" ]] && pass "relation hydrated on list" \
  || fail "relation hydration" "expected '$ITEM_REC_ID', got '$HYDRATED'"

# Cross-table rollup: the rollup column on orders should expose the
# price of the linked item (99.99 — only one item linked from this
# order). Pre-fix this returned null because buildComputedProjections
# couldn't resolve the target field's storage descriptor across tables.
ROLLUP=$(json ".items[] | select(.id==\"$ORDER_REC_ID\") | .data[\"$ROLLUP_FIELD_ID\"]")
if [[ "$ROLLUP" == "99.99" || "$ROLLUP" == "99.990000" ]]; then
  pass "cross-table rollup projects target value"
else
  fail "cross-table rollup" "expected 99.99, got '$ROLLUP'"
fi

# ────────────────────────────────────────────────────────────────────
# Audit cross-table leak (Wave 2.4)
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ audit scoping ━━━"

# Legitimate audit lookup returns the create entry.
http GET /api/grids/records/$ITEMS_TABLE_ID/$ITEM_REC_ID/audit
expect_status 200 "GET audit (legit table+record) → 200"
AUDIT_COUNT=$(json '.items | length')
[[ "$AUDIT_COUNT" -ge 1 ]] && pass "audit returns ≥1 entry for legit pair" \
  || fail "audit legit count" "got $AUDIT_COUNT"

# Wrong-table guess — record exists, but in a different table. Must
# return empty (chunk 7 critical: was leaking).
http GET /api/grids/records/$ORDERS_TABLE_ID/$ITEM_REC_ID/audit
expect_status 200 "GET audit (wrong-table guess) → 200"
LEAKED=$(json '.items | length')
[[ "$LEAKED" == "0" ]] && pass "audit empty for wrong-table guess (no leak)" \
  || fail "audit cross-table leak" "got $LEAKED entries instead of 0"

# ────────────────────────────────────────────────────────────────────
# Group-by + aggregations: currency sum across records (group-compiler
# storage-descriptor adoption). Two items with prices that should sum
# via SUM(try_numeric(data->fld->>'amount')). Pre-refactor this was
# wired up inline; the descriptor now owns it and the smoke test pins
# the SQL contract.
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ group-by + aggregations ━━━"

# Add a second item so SUM has something non-trivial to aggregate.
http POST /api/grids/records/by-table/$ITEMS_TABLE_ID "{\"$NAME_FIELD_ID\":\"gadget\",\"$PRICE_FIELD_ID\":150}"
expect_status 201 "POST second item record → 201"

# Group-by on a scalar (name field) with sum(price) — the simplest path
# that hits both resolveGroupBy and buildAggExpr through the descriptor.
http POST /api/grids/tables/$ITEMS_TABLE_ID/query "{\"query\":{\"groupBy\":[{\"fieldId\":\"$NAME_FIELD_ID\"}],\"aggregations\":[{\"fieldId\":\"$PRICE_FIELD_ID\",\"agg\":\"sum\"}]}}"
expect_status 200 "POST grouped query (sum) → 200"
BUCKETS=$(json '.buckets | length')
[[ "$BUCKETS" -ge 2 ]] && pass "grouped query returns ≥2 buckets" \
  || fail "grouped query bucket count" "expected ≥2, got $BUCKETS"

# Footer aggregate path (no groupBy) — exercises the same buildAggExpr
# logic via aggregate-compiler. Total over both records.
http POST /api/grids/tables/$ITEMS_TABLE_ID/query "{\"query\":{\"aggregations\":[{\"fieldId\":\"$PRICE_FIELD_ID\",\"agg\":\"sum\"}]}}"
expect_status 200 "POST footer aggregate (sum) → 200"
SUM=$(json ".aggregates[\"${PRICE_FIELD_ID}__sum\"]")
# The first item was 99.99, second 150 → 249.99. Accept either string
# or number form (bun-sql may return numeric as string for big values).
if [[ "$SUM" == "249.99" || "$SUM" == "249.990000" || "$SUM" == "249.99000000000000" ]]; then
  pass "footer sum produces 249.99"
else
  fail "footer sum value" "expected 249.99, got '$SUM'"
fi

# ────────────────────────────────────────────────────────────────────
# Field-dependents + saved-view cleanup on delete (Critical #11)
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ field-dependents + view cleanup ━━━"

# Save a view that touches the price field via filter, sort, AND
# search.fieldIds — deleting the field should strip ALL three. The
# search-fieldIds path was missed by the original cleanup (post-cleanup
# #11 extension).
VIEW_QUERY=$(cat <<JSON
{
  "name": "expensive",
  "shared": true,
  "query": {
    "filter": {"op": "AND", "filters": [{"fieldId": "$PRICE_FIELD_ID", "op": ">", "value": 50}]},
    "sort": [{"fieldId": "$PRICE_FIELD_ID", "direction": "desc"}],
    "search": {"q": "x", "fieldIds": ["$PRICE_FIELD_ID", "$NAME_FIELD_ID"]}
  }
}
JSON
)
http POST /api/grids/views/by-table/$ITEMS_TABLE_ID "$VIEW_QUERY"
expect_status 201 "POST view with price filter+sort+search → 201"
VIEW_ID=$(json '.id')

# Drop the rollup first — it references price as a BLOCKING dependent
# (the dependents scanner rightly refuses to auto-cleanup
# rollup/lookup/formula refs since they have computed-cell semantics).
# Without this, the price-delete below would 409 instead of testing
# the view-cleanup auto-strip path.
cleanup_delete /api/grids/fields/$ROLLUP_FIELD_ID

http DELETE /api/grids/fields/$PRICE_FIELD_ID
expect_status 204 "DELETE price field → 204"

# View now exists and the price ref has been stripped from filter,
# sort, AND search.fieldIds. The whole stored query is checked because
# stale refs in any of the three would break list/aggregate at compile
# time with `unknown field "X"`.
http GET /api/grids/views/$VIEW_ID
expect_status 200 "GET view after price delete → 200"
QUERY_BLOB=$(json '.query | tostring')
if [[ "$QUERY_BLOB" != *"$PRICE_FIELD_ID"* ]]; then
  pass "view query no longer references deleted field (filter+sort+search)"
else
  fail "view cleanup" "query still mentions $PRICE_FIELD_ID: $QUERY_BLOB"
fi
# search.fieldIds had two ids — only the deleted one should drop;
# name should survive. Empty-array handling: if both ids had been
# deleted, search.fieldIds should be removed entirely (so search
# reverts to "all fields") instead of degenerating into [].
SEARCH_FIELDS=$(json '.query.search.fieldIds // empty | tostring')
if [[ "$SEARCH_FIELDS" == *"$NAME_FIELD_ID"* ]]; then
  pass "search.fieldIds keeps surviving field id"
else
  fail "search.fieldIds cleanup" "expected to keep $NAME_FIELD_ID, got: $SEARCH_FIELDS"
fi

# ────────────────────────────────────────────────────────────────────
# Permission resolver: explicit deny shadows inherited grant (Wave 2.1)
# ────────────────────────────────────────────────────────────────────
# The dev admin bypasses ACLs (platform admin), so we can't see deny
# behaviour from this session — but we can at least exercise the gate
# code path by hitting a 404 path consistent with non-existent ids.

echo ""
echo "━━━ negative paths ━━━"

http GET /api/grids/views/00000000-0000-0000-0000-000000000000
expect_status 404 "GET non-existent view → 404"

http GET /api/grids/dashboards/00000000-0000-0000-0000-000000000000
expect_status 404 "GET non-existent dashboard → 404"

http POST /api/grids/tables/$ITEMS_TABLE_ID/query '{"query":{"sort":[{"fieldId":"00000000-0000-0000-0000-000000000000","direction":"asc"}]}}'
expect_status 400 "POST query with unknown sort field → 400"

# Sort on a relation field — Wave 4.1 made this a clean 400 instead
# of silently sorting all-NULL. Skip if we hit timing — relation
# field id may not always populate; fail-soft.
if [[ -n "${RELATION_FIELD_ID:-}" ]]; then
  http POST /api/grids/tables/$ORDERS_TABLE_ID/query "{\"query\":{\"sort\":[{\"fieldId\":\"$RELATION_FIELD_ID\",\"direction\":\"asc\"}]}}"
  expect_status 400 "POST query sort on relation field → 400"
fi

# ────────────────────────────────────────────────────────────────────
# Cleanup
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ cleanup ━━━"
cleanup_delete /api/grids/bases/$BASE_ID

# ────────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ summary ━━━"
echo "${C_PASS}PASS:${C_RESET} $PASS    ${C_FAIL}FAIL:${C_RESET} $FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
