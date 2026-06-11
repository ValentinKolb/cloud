import { describe, expect, test } from "bun:test";
import type { Field, Table, View } from "../../../service";
import { buildQueryCompletions } from "./query-completions";

const table = (overrides: Partial<Table> & Pick<Table, "id" | "shortId" | "name">): Table => ({
  baseId: "base",
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" },
  position: 0,
  disableDirectInsert: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "name" | "type" | "tableId">): Field => ({
  description: null,
  icon: null,
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const view = (overrides: Partial<View> & Pick<View, "id" | "shortId" | "name" | "tableId">): View => ({
  icon: null,
  query: {},
  displayConfig: { mode: "table" },
  ownerUserId: null,
  position: 0,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const accounts = table({ id: "accounts", shortId: "Acc01", name: "Accounts" });
const transactions = table({ id: "transactions", shortId: "Tx001", name: "Transactions" });

const completions = buildQueryCompletions({
  tables: [accounts, transactions],
  fieldsByTable: {
    accounts: [field({ id: "name", tableId: "accounts", shortId: "Nam01", name: "Name", type: "text" })],
    transactions: [field({ id: "amount", tableId: "transactions", shortId: "Amt01", name: "Amount", type: "number" })],
  },
  viewsByTable: {
    transactions: [view({ id: "recent", tableId: "transactions", shortId: "Rec01", name: "Recent transactions" })],
  },
});

const suggest = (trigger: string | undefined, query: string, fullText: string, tokenStart: number) => {
  const completion = completions.find((item) => item.trigger === trigger)!;
  const result = completion.suggest(query, { fullText, caret: fullText.length, tokenStart }, new AbortController().signal);
  if (result instanceof Promise) throw new Error("query completions should be synchronous in tests");
  return result;
};

describe("query completions", () => {
  test("source keyword snippets keep the cursor at the source position", () => {
    const [fromTable] = suggest(undefined, "from", "from", 0);
    expect(fromTable).toMatchObject({ text: "from table ", appendSpace: false });
  });

  test("after from table suggests tables by readable name", () => {
    const suggestions = suggest("#", "", "from table #", "from table ".length);
    expect(suggestions).toContainEqual(
      expect.objectContaining({ label: "Accounts", expansion: "Accounts", hint: "table · Accounts", appendSpace: false }),
    );
    expect(suggestions).not.toContainEqual(expect.objectContaining({ label: "Recent transactions" }));
  });

  test("after from view suggests views by readable name", () => {
    const suggestions = suggest("#", "", "from view #", "from view ".length);
    expect(suggestions).toContainEqual(
      expect.objectContaining({ label: "Recent transactions", expansion: '"Recent transactions"', hint: 'view · "Recent transactions"', appendSpace: false }),
    );
    expect(suggestions).not.toContainEqual(expect.objectContaining({ label: "Accounts" }));
  });

  test("plain source position suggests the matching sources", () => {
    const suggestions = suggest(undefined, "trans", "from table trans", "from table ".length);
    expect(suggestions).toContainEqual(expect.objectContaining({ label: "Transactions", expansion: "Transactions" }));
  });
});
