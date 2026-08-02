import { describe, expect, test } from "bun:test";
import { fail, ok } from "@k2b/stdlib";
import { z } from "zod";
import {
  CapabilitySemanticLinkSchema,
  defineCapabilities,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "../contracts/capabilities";
import { compileCapabilities, invokeCompiledCapability, reviewCompiledCapability } from "./capabilities";

const context = {
  actor: {
    kind: "user" as const,
    user: { id: "user-1", roles: ["user"] } as any,
  },
  accessSubject: { type: "user" as const, userId: "user-1" },
  user: { id: "user-1", roles: ["user"] } as any,
  signal: new AbortController().signal,
};

const example = () =>
  defineCapabilities({
    version: 1,
    types: {
      item: { title: "Item", description: "One test item." },
    },
    queries: {
      get: {
        title: "Get item",
        description: "Loads one item by its stable id.",
        input: z.object({ id: z.string().max(100).describe("Stable item id.") }).strict(),
        data: z.object({ id: z.string(), name: z.string() }).strict(),
        openWorld: false,
        run: async (input) =>
          ok({
            data: { id: input.id, name: "Example" },
            refs: [{ type: "example.item", id: input.id }],
          }),
      },
    },
    actions: {
      rename: {
        title: "Rename item",
        description: "Renames one item.",
        input: z
          .object({
            id: z.string().max(100).describe("Stable item id."),
            name: z.string().max(120).describe("New item name."),
          })
          .strict(),
        data: z.object({ id: z.string(), name: z.string() }).strict(),
        destructive: false,
        openWorld: false,
        approval: "once",
        idempotency: "required",
        target: { type: "item", inputField: "id" },
        review: async (input) =>
          ok({
            message: "This item will be renamed.",
            details: [{ label: "New name", value: input.name }],
            links: [{ rel: "open", href: `/app/example/${input.id}` }],
          }),
        run: async (input) => ok({ data: input, refs: [{ type: "example.item", id: input.id }] }),
      },
    },
  });

describe("capability v1 compilation", () => {
  test("builds deterministic namespaced manifests and schemas", () => {
    const first = compileCapabilities("example", example());
    const second = compileCapabilities("example", example());
    expect(first.manifest).toEqual(second.manifest);
    expect(first.manifest.types[0]?.id).toBe("example.item");
    expect(first.manifest.queries[0]?.id).toBe("example.get");
    expect(first.manifest.queries[0]?.openWorld).toBe(false);
    expect(first.manifest.actions[0]?.target?.type).toBe("example.item");
    expect(first.manifest.actions[0]?.review).toBe(true);
    expect(first.manifest.manifestHash).toHaveLength(64);
  });

  test("rejects transforms, open inputs, and undocumented fields", () => {
    expect(() =>
      compileCapabilities(
        "example",
        defineCapabilities({
          version: 1,
          queries: {
            bad: {
              title: "Bad",
              description: "Non-projectable input.",
              input: z
                .object({
                  value: z
                    .string()
                    .describe("Value.")
                    .transform((value) => value.trim()),
                })
                .strict(),
              data: z.string(),
              openWorld: false,
              run: async () => ok({ data: "" }),
            },
          },
        }),
      ),
    ).toThrow("not JSON-Schema-projectable");

    expect(() =>
      compileCapabilities(
        "example",
        defineCapabilities({
          version: 1,
          queries: {
            bad: {
              title: "Bad",
              description: "Open input.",
              input: z.looseObject({ value: z.string().describe("Value.") }),
              data: z.string(),
              openWorld: false,
              run: async () => ok({ data: "" }),
            },
          },
        }),
      ),
    ).toThrow("must reject unknown properties");

    expect(() =>
      compileCapabilities(
        "example",
        defineCapabilities({
          version: 1,
          queries: {
            bad: {
              title: "Bad",
              description: "Undocumented input.",
              input: z.object({ value: z.string() }).strict(),
              data: z.string(),
              openWorld: false,
              run: async () => ok({ data: "" }),
            },
          },
        }),
      ),
    ).toThrow("needs a concise Zod description");

    expect(() =>
      compileCapabilities(
        "example",
        defineCapabilities({
          version: 1,
          actions: {
            bad: {
              title: "Bad",
              description: "Collides with a transport field.",
              input: z.object({ idempotencyKey: z.string().describe("Collision.") }).strict(),
              data: z.object({}).strict(),
              destructive: false,
              openWorld: false,
              approval: "never",
              idempotency: "required",
              run: async () => ok({ data: {} }),
            },
          },
        }),
      ),
    ).toThrow('input field "idempotencyKey" is reserved');
  });

  test("allows multiple Universal Search queries per app", () => {
    const searchQuery = {
      title: "Search items",
      description: "Finds items for the global search surface.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: {
        tags: [{ tag: "item", title: "Items", description: "Search test items." }],
      },
      run: async () => ok({ data: [] }),
    };
    const compiled = compileCapabilities(
      "example",
      defineCapabilities({
        version: 1,
        queries: {
          first: searchQuery,
          second: {
            ...searchQuery,
            universalSearch: {
              tags: [
                {
                  tag: "other",
                  title: "Other",
                  description: "Search other items.",
                },
              ],
            },
          },
        },
      }),
    );
    expect(compiled.manifest.queries.filter((query) => query.universalSearch).map((query) => query.localId)).toEqual(["first", "second"]);

    expect(() =>
      compileCapabilities(
        "example",
        defineCapabilities({
          version: 1,
          queries: {
            first: searchQuery,
            local_only: {
              ...searchQuery,
              universalSearch: undefined,
            },
          },
        }),
      ),
    ).not.toThrow();
  });

  test("requires the canonical Universal Search schemas", () => {
    expect(() =>
      compileCapabilities(
        "example",
        defineCapabilities({
          version: 1,
          queries: {
            search: {
              title: "Search items",
              description: "Find items.",
              input: z.object({ query: z.string().describe("Search text.") }).strict(),
              data: UniversalSearchDataSchema,
              openWorld: false,
              universalSearch: { tags: [{ tag: "item", title: "Items", description: "Show items." }] },
              run: async () => ok({ data: [] }),
            },
          },
        }),
      ),
    ).toThrow("must use UniversalSearchInputSchema");
  });

  test("validates resource refs embedded in ordinary query result views", async () => {
    const compiled = compileCapabilities(
      "example",
      defineCapabilities({
        version: 1,
        types: { item: { title: "Item", description: "One test item." } },
        queries: {
          list: {
            title: "List items",
            description: "Lists navigable item cards.",
            input: z.object({}).strict(),
            data: UniversalSearchDataSchema,
            openWorld: false,
            run: async () =>
              ok({
                data: [
                  {
                    ref: { type: "other.item", id: "one" },
                    title: "One",
                    links: [{ rel: "open", href: "/app/example/one" }],
                  },
                ],
              }),
          },
        },
      }),
    );
    const query = compiled.manifest.queries[0]!;
    const result = await invokeCompiledCapability({
      compiled,
      kind: "query",
      localId: "list",
      input: {},
      expectedSchemaHash: query.schemaHash,
      context,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INTERNAL", message: "Capability returned undeclared resource type other.item" },
    });
  });

  test("rejects action targets that are absent from the input", () => {
    const base = example();
    const definitions = {
      ...base,
      actions: {
        ...base.actions,
        rename: { ...base.actions!.rename!, target: { type: "item", inputField: "missing" } },
      },
    };
    expect(() => compileCapabilities("example", definitions)).toThrow('target input field "missing" is not declared');
  });

  test("rejects manifests that are too large for the bounded live registry", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`field_${index}`, z.string().describe(`Documented field ${index}. ${"x".repeat(100)}`)]),
    );
    const queries = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `query_${index}`,
        {
          title: `Query ${index}`,
          description: `A deliberately large public query ${index}.`,
          input: z.object(fields).strict(),
          data: z.object({ id: z.string() }).strict(),
          openWorld: false,
          run: async () => ok({ data: { id: "one" } }),
        },
      ]),
    );

    expect(() => compileCapabilities("example", defineCapabilities({ version: 1, queries }))).toThrow("manifest exceeds the 262144-byte");
  });

  test("returns structured validation, schema, idempotency, and handler failures", async () => {
    const compiled = compileCapabilities("example", example());
    const query = compiled.manifest.queries[0]!;
    const action = compiled.manifest.actions[0]!;

    const stale = await invokeCompiledCapability({
      compiled,
      kind: "query",
      localId: "get",
      input: { id: "one" },
      expectedSchemaHash: "0".repeat(64),
      context,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_MISMATCH", status: 409 },
    });

    const invalid = await invokeCompiledCapability({
      compiled,
      kind: "query",
      localId: "get",
      input: {},
      expectedSchemaHash: query.schemaHash,
      context,
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED", status: 400 },
    });

    const missingKey = await invokeCompiledCapability({
      compiled,
      kind: "action",
      localId: "rename",
      input: { id: "one", name: "Two" },
      expectedSchemaHash: action.schemaHash,
      context,
    });
    expect(missingKey).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_KEY_REQUIRED", status: 400 },
    });

    const deniedDefinitions = {
      ...example(),
      queries: {
        ...example().queries,
        get: {
          ...example().queries!.get!,
          run: async () => fail({ code: "FORBIDDEN", message: "No access", status: 403 }),
        },
      },
    };
    const denied = compileCapabilities("example", deniedDefinitions);
    const deniedResult = await invokeCompiledCapability({
      compiled: denied,
      kind: "query",
      localId: "get",
      input: { id: "one" },
      expectedSchemaHash: denied.manifest.queries[0]!.schemaHash,
      context,
    });
    expect(deniedResult).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", status: 403 },
    });
  });

  test("resolves and validates an Action review without requiring idempotency", async () => {
    const compiled = compileCapabilities("example", example());
    const action = compiled.manifest.actions[0]!;
    const reviewed = await reviewCompiledCapability({
      compiled,
      localId: "rename",
      input: { id: "one", name: "Two" },
      expectedSchemaHash: action.schemaHash,
      context,
    });

    expect(reviewed).toEqual({
      ok: true,
      data: {
        message: "This item will be renamed.",
        details: [{ label: "New name", value: "Two" }],
        links: [{ rel: "open", href: "/app/example/one" }],
      },
    });

    expect(
      await reviewCompiledCapability({
        compiled,
        localId: "rename",
        input: { id: "one" },
        expectedSchemaHash: action.schemaHash,
        context,
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED", status: 400 } });
  });

  test("fails closed when an advertised review returns an invalid shape", async () => {
    const definitions = example();
    const compiled = compileCapabilities("example", {
      ...definitions,
      actions: {
        ...definitions.actions,
        rename: {
          ...definitions.actions!.rename!,
          review: async () => ok({ message: "", details: [] }),
        },
      },
    });
    const action = compiled.manifest.actions[0]!;

    expect(
      await reviewCompiledCapability({
        compiled,
        localId: "rename",
        input: { id: "one", name: "Two" },
        expectedSchemaHash: action.schemaHash,
        context,
      }),
    ).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Capability review returned an invalid result", status: 500 },
    });
  });

  test("reports unexpected handler failures without changing the public error", async () => {
    const base = example();
    const definitions = {
      ...base,
      queries: {
        ...base.queries,
        get: {
          ...base.queries!.get!,
          run: async () => {
            throw new Error("database password must stay private");
          },
        },
      },
    };
    const compiled = compileCapabilities("example", definitions);
    const errors: unknown[] = [];
    const result = await invokeCompiledCapability({
      compiled,
      kind: "query",
      localId: "get",
      input: { id: "one" },
      expectedSchemaHash: compiled.manifest.queries[0]!.schemaHash,
      context,
      onUnexpectedError: (error) => errors.push(error),
    });
    expect(errors).toHaveLength(1);
    expect(result).toEqual({ ok: false, error: { code: "INTERNAL", message: "Capability execution failed", status: 500 } });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  test("rejects undeclared refs returned by a handler", async () => {
    const base = example();
    const definitions = {
      ...base,
      queries: {
        ...base.queries,
        get: {
          ...base.queries!.get!,
          run: async (input: { id: string }) =>
            ok({
              data: { id: input.id, name: "Example" },
              refs: [{ type: "other.item", id: input.id }],
            }),
        },
      },
    };
    const compiled = compileCapabilities("example", definitions);
    const result = await invokeCompiledCapability({
      compiled,
      kind: "query",
      localId: "get",
      input: { id: "one" },
      expectedSchemaHash: compiled.manifest.queries[0]!.schemaHash,
      context,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INTERNAL", status: 500 },
    });
  });
});

test("semantic links cannot escape the Cloud origin through backslashes", () => {
  expect(CapabilitySemanticLinkSchema.safeParse({ rel: "open", href: "/app/demo" }).success).toBe(true);
  expect(CapabilitySemanticLinkSchema.safeParse({ rel: "open", href: "/\\\\evil.example/path" }).success).toBe(false);
});
