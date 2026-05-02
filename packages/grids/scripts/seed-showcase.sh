#!/usr/bin/env bash
# Seeds a "Field Type Showcase" base with one record per archetype so a
# clicker can step through every field type. Idempotent against multiple
# runs only insofar as it always creates a fresh base named with a timestamp.
set -euo pipefail
COOKIE=${COOKIE:-/tmp/grids-cookies.txt}
HOST=${HOST:-http://localhost:3000}
TS=$(date +%H%M%S)

api() {
  local method=$1 url=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sf -b "$COOKIE" -X "$method" "$HOST$url" -H 'content-type: application/json' -d "$body"
  else
    curl -sf -b "$COOKIE" -X "$method" "$HOST$url"
  fi
}
jid() { python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])'; }

echo "→ creating showcase base"
BASE=$(api POST /api/grids/bases "{\"name\":\"Demo Showcase $TS\",\"description\":\"Klick durch jeden Feldtyp\"}" | jid)
echo "  base=$BASE"

# ---------- Authors table (relation target) ----------
AUTH=$(api POST "/api/grids/tables/by-base/$BASE" '{"name":"Authors","description":"Relation target table"}' | jid)
echo "  authors-table=$AUTH"

A_NAME=$(api POST "/api/grids/fields/by-table/$AUTH"     '{"name":"name","type":"text","config":{"maxLength":120}}' | jid)
A_BIRTH=$(api POST "/api/grids/fields/by-table/$AUTH"    '{"name":"birth_year","type":"number","config":{"min":0,"max":3000}}' | jid)
A_COUNTRY=$(api POST "/api/grids/fields/by-table/$AUTH"  "{\"name\":\"country\",\"type\":\"single-select\",\"config\":{\"options\":[{\"id\":\"de\",\"label\":\"Germany\",\"color\":\"#ef4444\"},{\"id\":\"uk\",\"label\":\"United Kingdom\",\"color\":\"#3b82f6\"},{\"id\":\"us\",\"label\":\"United States\",\"color\":\"#10b981\"}]}}" | jid)

A1=$(api POST "/api/grids/records/by-table/$AUTH" "{\"$A_NAME\":\"J.R.R. Tolkien\",\"$A_BIRTH\":1892,\"$A_COUNTRY\":\"uk\"}" | jid)
A2=$(api POST "/api/grids/records/by-table/$AUTH" "{\"$A_NAME\":\"Hannah Arendt\",\"$A_BIRTH\":1906,\"$A_COUNTRY\":\"de\"}" | jid)
A3=$(api POST "/api/grids/records/by-table/$AUTH" "{\"$A_NAME\":\"Ursula K. Le Guin\",\"$A_BIRTH\":1929,\"$A_COUNTRY\":\"us\"}" | jid)
echo "  authors=$A1,$A2,$A3"

# ---------- Books table (the showcase) ----------
TBL=$(api POST "/api/grids/tables/by-base/$BASE" '{"name":"Books","description":"Eine Zeile pro Feldtyp-Demo"}' | jid)
echo "  books-table=$TBL"

# ---- Tier 1 ----
F_TITLE=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"title","type":"text","config":{"maxLength":200,"required":true}}' | jid)
F_DESCR=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"description","type":"longtext","config":{}}' | jid)
F_PAGES=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"pages","type":"number","config":{"min":1}}' | jid)
F_PRICE=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"price_eur","type":"decimal","config":{"precision":10,"scale":2}}' | jid)
F_INSTOCK=$(api POST  "/api/grids/fields/by-table/$TBL" '{"name":"in_stock","type":"boolean","config":{}}' | jid)
F_PUBDATE=$(api POST  "/api/grids/fields/by-table/$TBL" '{"name":"published","type":"date","config":{}}' | jid)
F_GENRE=$(api POST    "/api/grids/fields/by-table/$TBL" "{\"name\":\"genre\",\"type\":\"single-select\",\"config\":{\"options\":[{\"id\":\"fantasy\",\"label\":\"Fantasy\",\"color\":\"#a855f7\"},{\"id\":\"philosophy\",\"label\":\"Philosophy\",\"color\":\"#0ea5e9\"},{\"id\":\"scifi\",\"label\":\"Sci-Fi\",\"color\":\"#10b981\"}]}}" | jid)
F_TAGS=$(api POST     "/api/grids/fields/by-table/$TBL" "{\"name\":\"tags\",\"type\":\"multi-select\",\"config\":{\"options\":[{\"id\":\"classic\",\"label\":\"Classic\",\"color\":\"#f59e0b\"},{\"id\":\"recommended\",\"label\":\"Recommended\",\"color\":\"#22c55e\"},{\"id\":\"signed\",\"label\":\"Signed\",\"color\":\"#ec4899\"}],\"minSelected\":0,\"maxSelected\":3}}" | jid)
F_RATING=$(api POST   "/api/grids/fields/by-table/$TBL" '{"name":"rating","type":"rating","config":{"max":5}}' | jid)
F_AUTON=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"sku","type":"autonumber","config":{"prefix":"BK-","padding":4}}' | jid)

# ---- Tier 2 ----
F_EMAIL=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"contact_email","type":"email","config":{}}' | jid)
F_URL=$(api POST      "/api/grids/fields/by-table/$TBL" '{"name":"website","type":"url","config":{}}' | jid)
F_PHONE=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"phone","type":"phone","config":{}}' | jid)
F_CURR=$(api POST     "/api/grids/fields/by-table/$TBL" '{"name":"royalty","type":"currency","config":{"defaultCurrency":"EUR"}}' | jid)
F_PCT=$(api POST      "/api/grids/fields/by-table/$TBL" '{"name":"discount","type":"percent","config":{}}' | jid)
F_DUR=$(api POST      "/api/grids/fields/by-table/$TBL" '{"name":"reading_time","type":"duration","config":{}}' | jid)
F_SLUG=$(api POST     "/api/grids/fields/by-table/$TBL" '{"name":"slug","type":"slug","config":{}}' | jid)

# ---- Tier 3 ----
F_BAR=$(api POST      "/api/grids/fields/by-table/$TBL" '{"name":"barcode","type":"barcode","config":{}}' | jid)
F_ISBN=$(api POST     "/api/grids/fields/by-table/$TBL" '{"name":"isbn","type":"isbn","config":{}}' | jid)
F_COLOR=$(api POST    "/api/grids/fields/by-table/$TBL" '{"name":"cover_color","type":"color","config":{}}' | jid)
F_RICH=$(api POST     "/api/grids/fields/by-table/$TBL" '{"name":"notes_md","type":"rich-text","config":{}}' | jid)
F_JSON=$(api POST     "/api/grids/fields/by-table/$TBL" '{"name":"meta","type":"json","config":{}}' | jid)
F_SIG=$(api POST      "/api/grids/fields/by-table/$TBL" '{"name":"signature","type":"signature","config":{}}' | jid)
F_LOC=$(api POST      "/api/grids/fields/by-table/$TBL" '{"name":"birthplace","type":"location","config":{}}' | jid)

# ---- Phase 4: relation + lookup + rollup ----
F_AUTHOR=$(api POST   "/api/grids/fields/by-table/$TBL" "{\"name\":\"author\",\"type\":\"relation\",\"config\":{\"targetTableId\":\"$AUTH\",\"displayFieldId\":\"$A_NAME\",\"cardinality\":\"single\"}}" | jid)
F_AUTHNAME=$(api POST "/api/grids/fields/by-table/$TBL" "{\"name\":\"author_name\",\"type\":\"lookup\",\"config\":{\"relationFieldId\":\"$F_AUTHOR\",\"targetFieldId\":\"$A_NAME\"}}" | jid)
F_AUTHCNT=$(api POST  "/api/grids/fields/by-table/$TBL" "{\"name\":\"author_count\",\"type\":\"rollup\",\"config\":{\"relationFieldId\":\"$F_AUTHOR\",\"targetFieldId\":\"$A_BIRTH\",\"agg\":\"count\"}}" | jid)
F_AUTHBIRTH=$(api POST "/api/grids/fields/by-table/$TBL" "{\"name\":\"author_birthyear\",\"type\":\"rollup\",\"config\":{\"relationFieldId\":\"$F_AUTHOR\",\"targetFieldId\":\"$A_BIRTH\",\"agg\":\"min\"}}" | jid)

# ---- Phase 5: formula (chained, exercises topo + IF short-circuit) ----
F_TOTAL=$(api POST    "/api/grids/fields/by-table/$TBL" "{\"name\":\"total_with_vat\",\"type\":\"formula\",\"config\":{\"expression\":\"{${F_PRICE}} * 1.19\"}}" | jid)
F_AGE=$(api POST      "/api/grids/fields/by-table/$TBL" "{\"name\":\"author_age_at_pub\",\"type\":\"formula\",\"config\":{\"expression\":\"IF({${F_AUTHBIRTH}}=0, null, YEAR({${F_PUBDATE}}) - {${F_AUTHBIRTH}})\"}}" | jid)
F_PRICELBL=$(api POST "/api/grids/fields/by-table/$TBL" "{\"name\":\"price_label\",\"type\":\"formula\",\"config\":{\"expression\":\"CONCAT(UPPER({${F_TITLE}}), ' — €', {${F_PRICE}})\"}}" | jid)

echo "  fields created: $(api GET "/api/grids/fields/by-table/$TBL" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')"

# ---- sample records ----
api POST "/api/grids/records/by-table/$TBL" "$(cat <<JSON
{
  "$F_TITLE":"The Lord of the Rings",
  "$F_DESCR":"Eine epische Reise durch Mittelerde.",
  "$F_PAGES":1216,
  "$F_PRICE":"42.50",
  "$F_INSTOCK":true,
  "$F_PUBDATE":"1954-07-29",
  "$F_GENRE":"fantasy",
  "$F_TAGS":["classic","recommended"],
  "$F_RATING":5,
  "$F_EMAIL":"editor@allenandunwin.example",
  "$F_URL":"https://www.tolkienestate.com",
  "$F_PHONE":"+49 30 12345678",
  "$F_CURR":{"amount":12.34,"currency":"EUR"},
  "$F_PCT":0.15,
  "$F_DUR":"36000",
  "$F_SLUG":"the-lord-of-the-rings",
  "$F_BAR":"9780261103252",
  "$F_ISBN":"9780261103252",
  "$F_COLOR":"#7c3aed",
  "$F_RICH":"# Fellowship\\n\\nA story about *friendship*.",
  "$F_JSON":{"trilogy":true,"volumes":3},
  "$F_LOC":{"lat":-26.2041,"lng":28.0473,"label":"Bloemfontein, South Africa"},
  "$F_AUTHOR":["$A1"]
}
JSON
)" > /dev/null

api POST "/api/grids/records/by-table/$TBL" "$(cat <<JSON
{
  "$F_TITLE":"The Origins of Totalitarianism",
  "$F_DESCR":"Eine politiktheoretische Analyse des 20. Jahrhunderts.",
  "$F_PAGES":704,
  "$F_PRICE":"24.90",
  "$F_INSTOCK":true,
  "$F_PUBDATE":"1951-03-01",
  "$F_GENRE":"philosophy",
  "$F_TAGS":["classic"],
  "$F_RATING":4,
  "$F_CURR":{"amount":3.20,"currency":"EUR"},
  "$F_PCT":0.10,
  "$F_DUR":"21600",
  "$F_SLUG":"origins-of-totalitarianism",
  "$F_ISBN":"9780156701532",
  "$F_COLOR":"#1e3a8a",
  "$F_AUTHOR":["$A2"]
}
JSON
)" > /dev/null

api POST "/api/grids/records/by-table/$TBL" "$(cat <<JSON
{
  "$F_TITLE":"The Left Hand of Darkness",
  "$F_DESCR":"Erste Generation feministischer SF.",
  "$F_PAGES":304,
  "$F_PRICE":"14.99",
  "$F_INSTOCK":false,
  "$F_PUBDATE":"1969-03-01",
  "$F_GENRE":"scifi",
  "$F_TAGS":["recommended","signed"],
  "$F_RATING":5,
  "$F_CURR":{"amount":1.50,"currency":"EUR"},
  "$F_PCT":0.20,
  "$F_DUR":"14400",
  "$F_SLUG":"left-hand-of-darkness",
  "$F_ISBN":"9780441478125",
  "$F_COLOR":"#0ea5e9",
  "$F_AUTHOR":["$A3"]
}
JSON
)" > /dev/null

# Cycle-edge demo: a record with no author so the formula null-propagates,
# and one with division-by-zero scenario via IF short-circuit.
api POST "/api/grids/records/by-table/$TBL" "$(cat <<JSON
{
  "$F_TITLE":"Anonymous Manuscript",
  "$F_DESCR":"Ein Datensatz ohne Autor: lookup/rollup bleiben leer.",
  "$F_PAGES":42,
  "$F_PRICE":"0.00",
  "$F_INSTOCK":false,
  "$F_GENRE":"fantasy",
  "$F_RATING":1,
  "$F_SLUG":"anonymous"
}
JSON
)" > /dev/null

echo
echo "✅ Showcase ready:"
echo "   Base: $HOST/app/grids/$BASE"
echo "   Books: $HOST/app/grids/$BASE?table=$TBL"
echo "   Authors: $HOST/app/grids/$BASE?table=$AUTH"
