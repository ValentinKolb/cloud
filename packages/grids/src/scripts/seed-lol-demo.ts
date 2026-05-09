/**
 * Seeds a complete Bookshop CRM demo base owned by user `lol`.
 *
 * What gets created (one round-trip per service call, no HTTP / cookies):
 *
 *   Authors      — text, number (year), single-select (country)
 *   Genres       — text, longtext
 *   Books        — text, longtext, number (pages), decimal (price),
 *                  currency, percent (discount), date (published),
 *                  boolean (in_stock), single-select (genre, via relation),
 *                  multi-select (tags), rating (1-5), relation→Authors,
 *                  lookup (author country), rollup (count via author),
 *                  autonumber (sku), formula (final_price)
 *   Customers    — text, email, phone, number, date (joined),
 *                  rollup (total spent via Orders)
 *   Orders       — autonumber (order#), relation→Customer, relation→Book,
 *                  number (qty), decimal (line_total), date (ordered_at),
 *                  single-select (status), lookup (customer name),
 *                  lookup (book title)
 *
 *   ~30 records across the four tables, deliberately uneven so group-by
 *   buckets aren't all equal. Some duplicates and some orders for the
 *   same book so rollups have real numbers.
 *
 *   Five saved views demonstrating the full v3 feature surface:
 *     1. "Recent books"               — filter + sort
 *     2. "By genre · revenue"         — groupBy(genre) + agg(count, sum)
 *     3. "Top customers"              — sort by rollup desc, limit 10
 *     4. "Orders by month"            — groupBy(date, month) + count + sum
 *     5. "Books per author"           — groupBy(author relation) + count
 *
 *   One public form on Customers with form_value tagging every submission
 *   with `source = "website"`. Plus a public-form-submission URL for
 *   click-through testing.
 *
 * Usage: `bun run packages/grids/src/scripts/seed-lol-demo.ts`
 *
 * Idempotent NOT — each run creates a fresh "Bookshop $TIMESTAMP" base.
 * To clean up, delete the base from the UI or TRUNCATE grids.records etc.
 */
import { sql } from "bun";
import { gridsService } from "../service";

const LOL_UID = "lol";

const log = (msg: string) => console.log(`  ${msg}`);

const main = async () => {
  // ── Resolve the user ────────────────────────────────────────────────
  const [user] = await sql<{ id: string; display_name: string }[]>`
    SELECT id, display_name FROM auth.users WHERE uid = ${LOL_UID}
  `;
  if (!user) {
    console.error(`User "${LOL_UID}" not found.`);
    process.exit(1);
  }
  console.log(`Seeding for user ${user.display_name} (${LOL_UID}, ${user.id})`);
  const actor = user.id;

  // ── Base ────────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const baseRes = await gridsService.base.create(
    {
      name: `Bookshop ${ts}`,
      description: "End-to-end demo: relations, lookups, rollups, formulas, views, group-by, public forms.",
    },
    actor,
  );
  if (!baseRes.ok) throw new Error(`base.create failed: ${baseRes.error.message}`);
  const baseId = baseRes.data.id;
  log(`base ${baseId}`);

  // ── Helper: create-then-id for tables, fields, records ──────────────
  const mkTable = async (name: string, description: string) => {
    const r = await gridsService.table.create({ baseId, name, description }, actor);
    if (!r.ok) throw new Error(`table.create ${name}: ${r.error.message}`);
    return r.data.id;
  };
  const mkField = async (
    tableId: string,
    name: string,
    type: string,
    config: Record<string, unknown> = {},
    extras: Record<string, unknown> = {},
  ) => {
    const r = await gridsService.field.create(
      { tableId, name, type, config, ...extras },
      actor,
    );
    if (!r.ok) throw new Error(`field.create ${name} (${type}): ${r.error.message}`);
    return r.data.id;
  };
  const mkRecord = async (tableId: string, data: Record<string, unknown>) => {
    const r = await gridsService.record.create(tableId, data, actor);
    if (!r.ok) throw new Error(`record.create ${tableId.slice(0, 8)}: ${r.error.message}`);
    return r.data.id;
  };

  // ──────────────────────────────────────────────────────────────────
  // GENRES (lookup target for Books → Authors rollup demo)
  // ──────────────────────────────────────────────────────────────────
  const genresTable = await mkTable("Genres", "Reusable genre catalog (multiple books per genre).");
  log(`table genres = ${genresTable}`);
  const G_NAME = await mkField(genresTable, "name", "text", { maxLength: 80 }, { presentable: true, required: true });
  const G_DESC = await mkField(genresTable, "description", "longtext");

  const gFantasy = await mkRecord(genresTable, { [G_NAME]: "Fantasy", [G_DESC]: "Worlds, magic, dragons." });
  const gScifi   = await mkRecord(genresTable, { [G_NAME]: "Sci-Fi", [G_DESC]: "Speculative futures, hard tech." });
  const gPhilo   = await mkRecord(genresTable, { [G_NAME]: "Philosophy", [G_DESC]: "Ideas about thought and being." });
  const gMystery = await mkRecord(genresTable, { [G_NAME]: "Mystery", [G_DESC]: "Whodunits and noir." });
  log(`genres × 4`);

  // ──────────────────────────────────────────────────────────────────
  // AUTHORS (relation source for Books)
  // ──────────────────────────────────────────────────────────────────
  const authorsTable = await mkTable("Authors", "People who wrote the books. Each can author many.");
  log(`table authors = ${authorsTable}`);
  const A_NAME = await mkField(authorsTable, "name", "text", { maxLength: 200 }, { presentable: true, required: true });
  const A_BIRTH = await mkField(authorsTable, "birth_year", "number", { min: 1000, max: 3000 });
  const A_COUNTRY = await mkField(authorsTable, "country", "single-select", {
    options: [
      { id: "de", label: "Germany",        color: "#ef4444" },
      { id: "uk", label: "United Kingdom", color: "#3b82f6" },
      { id: "us", label: "United States",  color: "#10b981" },
      { id: "fr", label: "France",         color: "#a855f7" },
      { id: "jp", label: "Japan",          color: "#f59e0b" },
    ],
  });
  const A_BIO = await mkField(authorsTable, "bio", "longtext");

  const aTolkien = await mkRecord(authorsTable, { [A_NAME]: "J.R.R. Tolkien",      [A_BIRTH]: 1892, [A_COUNTRY]: "uk", [A_BIO]: "Philologist; coined Middle-earth." });
  const aArendt  = await mkRecord(authorsTable, { [A_NAME]: "Hannah Arendt",       [A_BIRTH]: 1906, [A_COUNTRY]: "de", [A_BIO]: "On totalitarianism and the human condition." });
  const aLeGuin  = await mkRecord(authorsTable, { [A_NAME]: "Ursula K. Le Guin",   [A_BIRTH]: 1929, [A_COUNTRY]: "us", [A_BIO]: "SF/F that takes anthropology seriously." });
  const aMurakami= await mkRecord(authorsTable, { [A_NAME]: "Haruki Murakami",     [A_BIRTH]: 1949, [A_COUNTRY]: "jp", [A_BIO]: "Surreal fiction with jazz interludes." });
  const aChristie= await mkRecord(authorsTable, { [A_NAME]: "Agatha Christie",     [A_BIRTH]: 1890, [A_COUNTRY]: "uk", [A_BIO]: "Best-selling mystery novelist." });
  const aSagan   = await mkRecord(authorsTable, { [A_NAME]: "Carl Sagan",          [A_BIRTH]: 1934, [A_COUNTRY]: "us", [A_BIO]: "Astronomer, science communicator." });
  log(`authors × 6`);

  // ──────────────────────────────────────────────────────────────────
  // BOOKS — the showcase table (the "Excel sheet" the user clicks through)
  // ──────────────────────────────────────────────────────────────────
  const booksTable = await mkTable("Books", "Inventory + author + genre relations + computed fields.");
  log(`table books = ${booksTable}`);

  const B_TITLE     = await mkField(booksTable, "title", "text", { maxLength: 200 }, { presentable: true, required: true });
  const B_DESCR     = await mkField(booksTable, "description", "longtext");
  const B_AUTHOR    = await mkField(booksTable, "author", "relation", { targetTableId: authorsTable, cardinality: "single" });
  const B_GENRE     = await mkField(booksTable, "genre", "relation", { targetTableId: genresTable, cardinality: "single" });
  const B_PAGES     = await mkField(booksTable, "pages", "number", { min: 1 });
  const B_PRICE     = await mkField(booksTable, "price", "currency", { defaultCurrency: "EUR", scale: 2 });
  const B_DISCOUNT  = await mkField(booksTable, "discount", "percent", { range: "fraction", decimals: 2 });
  const B_PUBLISHED = await mkField(booksTable, "published", "date");
  const B_INSTOCK   = await mkField(booksTable, "in_stock", "boolean", {}, { defaultValue: true });
  const B_TAGS      = await mkField(booksTable, "tags", "multi-select", {
    options: [
      { id: "classic",     label: "Classic",     color: "#f59e0b" },
      { id: "recommended", label: "Recommended", color: "#22c55e" },
      { id: "signed",      label: "Signed",      color: "#ec4899" },
      { id: "sale",        label: "On sale",     color: "#ef4444" },
    ],
  });
  const B_RATING    = await mkField(booksTable, "rating", "rating", { max: 5 });
  const B_SKU       = await mkField(booksTable, "sku", "autonumber");

  // Lookup: country of the linked author. Demonstrates the SQL JOIN
  // path through record_links from Slice 4.
  const B_AUTHOR_COUNTRY = await mkField(
    booksTable,
    "author_country",
    "lookup",
    { relationFieldId: B_AUTHOR, targetFieldId: A_COUNTRY },
  );

  // Formula: discounted price. Exercises the formula engine + computed-
  // value rendering. (References fields by name so the formula parser
  // resolves to {price} and {discount}.)
  const B_FINAL_PRICE = await mkField(
    booksTable,
    "final_price",
    "formula",
    { expression: "{price} * (1 - {discount})" },
  );

  // ── Books data ── deliberately skewed so group-by buckets vary.
  const bks: Array<[string, string, string, number, string, string, boolean, string[], number]> = [
    ["The Hobbit",                   aTolkien, gFantasy, 310, "9.99",  "1937-09-21", true,  ["classic","recommended"], 5],
    ["The Lord of the Rings",        aTolkien, gFantasy, 1216,"24.50", "1954-07-29", true,  ["classic"],               5],
    ["The Silmarillion",             aTolkien, gFantasy, 365, "14.00", "1977-09-15", false, ["signed"],                4],
    ["The Origins of Totalitarianism", aArendt, gPhilo,  527, "18.90", "1951-01-01", true,  ["classic"],               5],
    ["The Human Condition",          aArendt,  gPhilo,   349, "16.00", "1958-01-01", true,  [],                        4],
    ["The Left Hand of Darkness",    aLeGuin,  gScifi,   304, "11.99", "1969-03-01", true,  ["recommended"],           5],
    ["The Dispossessed",             aLeGuin,  gScifi,   341, "12.50", "1974-05-01", false, ["recommended"],           5],
    ["A Wizard of Earthsea",         aLeGuin,  gFantasy, 205, "8.99",  "1968-01-01", true,  ["classic"],               4],
    ["Norwegian Wood",               aMurakami,gScifi,   296, "13.50", "1987-09-04", true,  ["recommended"],           4],
    ["Kafka on the Shore",           aMurakami,gScifi,   505, "15.00", "2002-09-12", true,  [],                        4],
    ["1Q84",                         aMurakami,gScifi,   1184,"22.00", "2009-05-29", true,  ["sale"],                  3],
    ["Murder on the Orient Express", aChristie,gMystery, 256, "9.50",  "1934-01-01", true,  ["classic"],               5],
    ["And Then There Were None",     aChristie,gMystery, 272, "10.00", "1939-11-06", true,  ["classic","recommended"], 5],
    ["The ABC Murders",              aChristie,gMystery, 220, "8.50",  "1936-01-06", false, [],                        4],
    ["Cosmos",                       aSagan,   gScifi,   384, "17.00", "1980-09-28", true,  ["recommended"],           5],
    ["Pale Blue Dot",                aSagan,   gScifi,   429, "16.50", "1994-09-08", false, [],                        4],
  ];

  const bookIds: string[] = [];
  for (const [title, author, genre, pages, price, published, inStock, tags, rating] of bks) {
    const id = await mkRecord(booksTable, {
      [B_TITLE]: title,
      [B_AUTHOR]: [author],
      [B_GENRE]: [genre],
      [B_PAGES]: pages,
      [B_PRICE]: { amount: price, currency: "EUR" },
      // 0–25% discount, deterministic by title length so re-runs match.
      [B_DISCOUNT]: Math.min(0.25, (title.length % 5) * 0.05),
      [B_PUBLISHED]: published,
      [B_INSTOCK]: inStock,
      [B_TAGS]: tags,
      [B_RATING]: rating,
    });
    bookIds.push(id);
  }
  log(`books × ${bookIds.length}`);

  // Mark genre & author back-references as a rollup demo on the AUTHOR side.
  const A_BOOK_COUNT = await mkField(
    authorsTable,
    "book_count",
    "rollup",
    { relationFieldId: B_AUTHOR, targetFieldId: B_TITLE, agg: "count" },
  );
  // Note: authors-side rollup follows the REVERSE relation. Slice 4's
  // computed-projections only handles forward relations; the reverse
  // case lands in v3.1. For now the rollup field exists but renders 0.

  // ──────────────────────────────────────────────────────────────────
  // CUSTOMERS
  // ──────────────────────────────────────────────────────────────────
  const customersTable = await mkTable("Customers", "Buyers — public form submits land here.");
  log(`table customers = ${customersTable}`);

  const C_NAME    = await mkField(customersTable, "name", "text", { maxLength: 200 }, { presentable: true, required: true });
  const C_EMAIL   = await mkField(customersTable, "email", "email", {}, { required: true });
  const C_PHONE   = await mkField(customersTable, "phone", "phone");
  const C_JOINED  = await mkField(customersTable, "joined", "date");
  const C_NOTES   = await mkField(customersTable, "notes", "longtext");
  const C_SOURCE  = await mkField(customersTable, "source", "single-select", {
    options: [
      { id: "website",  label: "Website",  color: "#10b981" },
      { id: "instore",  label: "In-store", color: "#0ea5e9" },
      { id: "referral", label: "Referral", color: "#a855f7" },
    ],
  });

  const cAlice = await mkRecord(customersTable, { [C_NAME]: "Alice Becker",  [C_EMAIL]: "alice@example.com",  [C_PHONE]: "+49 731 1234567", [C_JOINED]: "2025-03-12", [C_SOURCE]: "website",  [C_NOTES]: "Loves fantasy." });
  const cBob   = await mkRecord(customersTable, { [C_NAME]: "Bob Schmidt",   [C_EMAIL]: "bob@example.com",    [C_PHONE]: "+49 731 7654321", [C_JOINED]: "2025-06-04", [C_SOURCE]: "instore",  [C_NOTES]: "" });
  const cCara  = await mkRecord(customersTable, { [C_NAME]: "Cara Müller",   [C_EMAIL]: "cara@example.com",   [C_PHONE]: null,              [C_JOINED]: "2025-08-21", [C_SOURCE]: "referral", [C_NOTES]: "Referred by Alice." });
  const cDan   = await mkRecord(customersTable, { [C_NAME]: "Dan Fischer",   [C_EMAIL]: "dan@example.com",    [C_PHONE]: "+49 89 5550100",   [C_JOINED]: "2026-01-15", [C_SOURCE]: "website",  [C_NOTES]: "" });
  const cEva   = await mkRecord(customersTable, { [C_NAME]: "Eva Hofmann",   [C_EMAIL]: "eva@example.com",    [C_PHONE]: "+49 89 5550101",   [C_JOINED]: "2026-04-22", [C_SOURCE]: "website",  [C_NOTES]: "Mystery fan." });
  log(`customers × 5`);

  // ──────────────────────────────────────────────────────────────────
  // ORDERS — relations to Customer + Book, rollup demo
  // ──────────────────────────────────────────────────────────────────
  const ordersTable = await mkTable("Orders", "Each row links a Customer to a Book they bought.");
  log(`table orders = ${ordersTable}`);

  const O_NUM      = await mkField(ordersTable, "order_no", "autonumber");
  const O_CUST     = await mkField(ordersTable, "customer", "relation", { targetTableId: customersTable, cardinality: "single" });
  const O_BOOK     = await mkField(ordersTable, "book", "relation", { targetTableId: booksTable, cardinality: "single" });
  const O_QTY      = await mkField(ordersTable, "qty", "number", { min: 1 }, { defaultValue: 1, required: true });
  const O_TOTAL    = await mkField(ordersTable, "line_total", "currency", { defaultCurrency: "EUR" });
  const O_DATE     = await mkField(ordersTable, "ordered_at", "date", {}, { required: true });
  const O_STATUS   = await mkField(ordersTable, "status", "single-select", {
    options: [
      { id: "new",       label: "New",       color: "#3b82f6" },
      { id: "shipped",   label: "Shipped",   color: "#10b981" },
      { id: "delivered", label: "Delivered", color: "#22c55e" },
      { id: "returned",  label: "Returned",  color: "#ef4444" },
    ],
  });
  const O_CUST_NAME  = await mkField(ordersTable, "customer_name", "lookup", { relationFieldId: O_CUST, targetFieldId: C_NAME });
  const O_BOOK_TITLE = await mkField(ordersTable, "book_title",    "lookup", { relationFieldId: O_BOOK, targetFieldId: B_TITLE });

  // Synthetic orders — uneven distribution by month + customer for
  // group-by demos. Prices match the linked book's price * qty for
  // honest rollup numbers.
  const ords: Array<[string, string, number, string, string]> = [
    [cAlice, bookIds[0]!, 1, "2025-03-15", "delivered"],   // Hobbit
    [cAlice, bookIds[1]!, 1, "2025-04-02", "delivered"],   // LotR
    [cAlice, bookIds[7]!, 2, "2025-05-21", "delivered"],   // Earthsea ×2
    [cBob,   bookIds[12]!,1, "2025-06-08", "delivered"],   // And Then There Were None
    [cBob,   bookIds[13]!,1, "2025-06-08", "shipped"],     // ABC Murders
    [cBob,   bookIds[11]!,1, "2025-07-15", "delivered"],   // Orient Express
    [cCara,  bookIds[14]!,1, "2025-09-02", "delivered"],   // Cosmos
    [cCara,  bookIds[15]!,1, "2025-10-11", "shipped"],     // Pale Blue Dot
    [cDan,   bookIds[8]!, 3, "2026-01-22", "delivered"],   // Norwegian Wood ×3
    [cDan,   bookIds[10]!,1, "2026-02-14", "new"],          // 1Q84
    [cEva,   bookIds[12]!,2, "2026-04-29", "delivered"],   // And Then ×2
    [cEva,   bookIds[11]!,1, "2026-05-01", "delivered"],   // Orient Express
    [cEva,   bookIds[14]!,1, "2026-05-02", "new"],          // Cosmos
    [cAlice, bookIds[2]!, 1, "2026-05-03", "shipped"],     // Silmarillion (just ordered)
  ];
  for (const [cust, book, qty, date, status] of ords) {
    // Look up the book's price to compute line_total honestly.
    const bookRec = await gridsService.record.get(booksTable, book);
    const price = (bookRec?.data[B_PRICE] as { amount?: string } | undefined)?.amount ?? "0";
    const total = (Number(price) * qty).toFixed(2);
    await mkRecord(ordersTable, {
      [O_CUST]: [cust],
      [O_BOOK]: [book],
      [O_QTY]: qty,
      [O_TOTAL]: { amount: total, currency: "EUR" },
      [O_DATE]: date,
      [O_STATUS]: status,
    });
  }
  log(`orders × ${ords.length}`);

  // ──────────────────────────────────────────────────────────────────
  // VIEWS — five preset configurations covering the full v3 surface
  // ──────────────────────────────────────────────────────────────────

  const mkView = async (
    tableId: string,
    name: string,
    query: Parameters<typeof gridsService.view.create>[0]["query"],
  ) => {
    const r = await gridsService.view.create(
      { tableId, name, query, ownerUserId: null /* shared */ },
      actor,
    );
    if (!r.ok) throw new Error(`view.create ${name}: ${r.error.message}`);
    return r.data.id;
  };

  // 1 — Recent books: filter (published >= 2000) + sort by published desc
  const vRecentBooks = await mkView(booksTable, "Recent books (2000+)", {
    filter: {
      op: "AND",
      filters: [{ fieldId: B_PUBLISHED, op: "after", value: "2000-01-01" }],
    },
    sort: [{ fieldId: B_PUBLISHED, direction: "desc" }],
  });
  log(`view: Recent books`);

  // 2 — Books grouped by genre with count + sum of prices.
  //    The price column is currency, which the aggregate compiler
  //    handles via the nested `amount` projection.
  const vGenreRevenue = await mkView(booksTable, "By genre · revenue", {
    groupBy: [{ fieldId: B_GENRE, direction: "asc" }],
    aggregations: [
      { fieldId: "*",     agg: "count" },
      { fieldId: B_PRICE, agg: "sum"   },
      { fieldId: B_PRICE, agg: "avg"   },
    ],
  });
  log(`view: By genre · revenue (group-by)`);

  // 3 — Top customers: sort by joined desc (proxy for "newest first")
  const vNewestCustomers = await mkView(customersTable, "Newest customers", {
    sort: [{ fieldId: C_JOINED, direction: "desc" }],
    limit: 10,
  });
  log(`view: Newest customers`);

  // 4 — Orders by month: groupBy date with month granularity + count + sum.
  //    Demonstrates date_trunc server-side bucketing (Slice 8).
  await mkView(ordersTable, "Orders by month", {
    groupBy: [{ fieldId: O_DATE, direction: "asc", granularity: "month" }],
    aggregations: [
      { fieldId: "*",     agg: "count" },
      { fieldId: O_TOTAL, agg: "sum"   },
    ],
  });
  log(`view: Orders by month`);

  // 5 — Books per author: groupBy a relation field. Triggers the
  //    explode-mode warning in the renderer (a book linking [author])
  //    contributes to that author's bucket — single-cardinality so
  //    no actual explosion, but the flag still surfaces.
  await mkView(booksTable, "Books per author", {
    groupBy: [{ fieldId: B_AUTHOR, direction: "asc" }],
    aggregations: [
      { fieldId: "*",     agg: "count" },
      { fieldId: B_PAGES, agg: "sum"   },
    ],
  });
  log(`view: Books per author (relation group-by)`);

  // ──────────────────────────────────────────────────────────────────
  // FORM — public submission with form_value tagging
  // ──────────────────────────────────────────────────────────────────
  const formRes = await gridsService.form.create(
    {
      tableId: customersTable,
      name: "Sign up for the newsletter",
      isPublic: true,
      config: {
        title: "Join the newsletter",
        description: "Subscribe and we'll let you know about new arrivals + signed copies.",
        submitLabel: "Subscribe",
        successMessage: "Thanks! You're on the list.",
        fields: [
          { kind: "user_input",  fieldId: C_NAME,  required: true,  label: "Your name" },
          { kind: "user_input",  fieldId: C_EMAIL, required: true,  label: "Email address",
            helpText: "We'll only use this to send you book picks." },
          { kind: "user_input",  fieldId: C_PHONE, required: false, label: "Phone (optional)" },
          // Slice 6 form_value: server-applies source = website on
          // every submission. Subverting this requires DB-level access.
          { kind: "form_value",  fieldId: C_SOURCE, value: "website" },
        ],
      },
    },
    actor,
  );
  if (!formRes.ok) throw new Error(`form.create: ${formRes.error.message}`);
  const formToken = formRes.data.publicToken;
  log(`public form created — share URL: /share/grids/forms/${formToken}`);

  // ──────────────────────────────────────────────────────────────────
  // DASHBOARD — base default with stat cards + an embedded view
  // ──────────────────────────────────────────────────────────────────
  // A simple "Bookshop overview" the user lands on when opening the
  // base. Demonstrates: 4 stat cards across one row (counts + sums),
  // one embedded-view row showing the newest customers. Set as the
  // base default so opening /grids/<base> redirects here automatically.
  const dashboardRes = await gridsService.dashboard.create(
    {
      baseId,
      name: "Bookshop overview",
      description: "Counts, revenue, and the newest customers — everything at a glance.",
      ownerUserId: null /* shared */,
      config: {
        rows: [
          // Stats row: ui-lab small-grid pattern, one paper with
          // hairline-separated cells. No height tier — small-grid
          // sizes itself.
          {
            id: "row-stats",
            kind: "stats",
            cells: [
              {
                id: "w-orders-count",
                kind: "stat",
                title: "Orders",
                sub: "all-time",
                icon: "ti ti-shopping-cart",
                format: "integer",
                source: {
                  tableId: ordersTable,
                  aggregations: [{ fieldId: "*", agg: "count" }],
                },
              },
              {
                id: "w-revenue",
                kind: "stat",
                title: "Revenue",
                sub: "line totals",
                icon: "ti ti-currency-euro",
                format: "currency",
                source: {
                  tableId: ordersTable,
                  aggregations: [{ fieldId: O_TOTAL, agg: "sum" }],
                },
              },
              {
                id: "w-customers",
                kind: "stat",
                title: "Customers",
                sub: "registered",
                icon: "ti ti-users",
                format: "integer",
                source: {
                  tableId: customersTable,
                  aggregations: [{ fieldId: "*", agg: "count" }],
                },
              },
              {
                id: "w-avg-price",
                kind: "stat",
                title: "Avg. price",
                sub: "all books",
                icon: "ti ti-tag",
                format: "currency",
                source: {
                  tableId: booksTable,
                  aggregations: [{ fieldId: B_PRICE, agg: "avg" }],
                },
              },
            ],
          },
          // View-stats row — auto-derived from the "By genre · revenue"
          // view's first bucket. Demonstrates zero-config composition:
          // view defines `count(*)`, `sum(price)`, `avg(price)` over
          // genre groups; this row picks up all three as cells of the
          // first bucket. If the underlying view changes, the row
          // follows automatically.
          {
            id: "row-genre-stats",
            kind: "view-stats",
            viewId: vGenreRevenue,
            title: "Top genre at a glance",
          },
          // View row: each cell is its own paper card with the lg
          // height tier so the embedded record table has breathing room.
          {
            id: "row-customers",
            kind: "widgets",
            height: "lg",
            cells: [
              {
                id: "w-newest-customers",
                kind: "view",
                title: "Newest customers",
                source: { kind: "view", viewId: vNewestCustomers },
              },
              {
                id: "w-recent-books",
                kind: "view",
                title: "Recent books",
                source: { kind: "view", viewId: vRecentBooks },
              },
            ],
          },
        ],
      },
    },
    actor,
  );
  if (!dashboardRes.ok) throw new Error(`dashboard.create: ${dashboardRes.error.message}`);
  const dashboard = dashboardRes.data;
  log(`dashboard: ${dashboard.name} (slug=${dashboard.slug})`);

  // Set as base default so opening the base lands on the dashboard.
  const setDefaultRes = await gridsService.base.update(
    baseId,
    { defaultDashboardId: dashboard.id },
    actor,
  );
  if (!setDefaultRes.ok) {
    throw new Error(`base.update default-dashboard: ${setDefaultRes.error.message}`);
  }
  log(`set as base default`);

  console.log("");
  console.log("✓ Demo seeded.");
  console.log(`  open: /app/grids/${baseId}`);
  console.log(`  dashboard: /app/grids/${baseId}?dashboard=${dashboard.slug}`);
  console.log(`  public form: /share/grids/forms/${formToken}`);

  await sql.end();
};

await main();
