import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { projectPublicIds, resolvePublicIds } from "./public-resources";

const database = (rows: unknown[], calls: Array<{ query: string; parameters: unknown[] }>): SQL =>
  ({
    unsafe: async (query: string, parameters: unknown[]) => {
      calls.push({ query, parameters });
      return rows;
    },
  }) as unknown as SQL;

describe("public resource ID batches", () => {
  test("binds public IDs as one Postgres text array", async () => {
    const calls: Array<{ query: string; parameters: unknown[] }> = [];
    const ids = await resolvePublicIds(
      "base",
      ["8yMtTb", "Ab12Cd", "8yMtTb"],
      database(
        [
          { publicId: "8yMtTb", internalId: "11111111-1111-4111-8111-111111111111" },
          { publicId: "Ab12Cd", internalId: "22222222-2222-4222-8222-222222222222" },
        ],
        calls,
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("ANY($1::text[])");
    expect(calls[0]?.parameters).toEqual(['{"8yMtTb","Ab12Cd"}']);
    expect(ids.get("8yMtTb")).toBe("11111111-1111-4111-8111-111111111111");
  });

  test("binds internal IDs as one Postgres UUID array", async () => {
    const calls: Array<{ query: string; parameters: unknown[] }> = [];
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const ids = await projectPublicIds(
      "base",
      [first, second, first],
      database(
        [
          { internalId: first, publicId: "8yMtTb" },
          { internalId: second, publicId: "Ab12Cd" },
        ],
        calls,
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("ANY($1::uuid[])");
    expect(calls[0]?.parameters).toEqual([`{${first},${second}}`]);
    expect(ids.get(first)).toBe("8yMtTb");
  });
});
