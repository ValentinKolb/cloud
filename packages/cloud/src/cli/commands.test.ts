import { describe, expect, test } from "bun:test";
import {
  arg,
  type CloudCliContext,
  type CloudCliFlags,
  command,
  confirmFlag,
  defineCliCommands,
  flag,
  paginationFlags,
  readCliInput,
} from "./index";

const createContext = (args: string[], flags: CloudCliFlags = {}) => {
  const lines: string[] = [];
  const ctx: CloudCliContext = {
    args,
    flags,
    options: { profile: "test", server: "http://example.test", token: "token", output: "text" },
    getDefault: async () => undefined,
    setDefault: async () => undefined,
    createApiClient: (() => {
      throw new Error("not needed");
    }) as CloudCliContext["createApiClient"],
    fetch: async () => Response.json({}),
    readJson: async (response) => response.json(),
    print: (value = "") => lines.push(value),
    write: (value) => lines.push(value),
    error: (value) => lines.push(value),
    json: (value) => lines.push(JSON.stringify(value, null, 2)),
    jsonLine: (value) => lines.push(JSON.stringify(value)),
    table: () => undefined,
  };
  return { ctx, lines };
};

describe("CLI command builder", () => {
  test("dispatches nested commands with typed args and flags", async () => {
    let captured: unknown;
    const mod = defineCliCommands({
      name: "admin",
      summary: "Admin commands",
      commands: [
        command("logs list", {
          summary: "List logs",
          args: { source: arg.optional() },
          flags: {
            search: flag.string({ aliases: ["q"] }),
            level: flag.enum(["info", "warn", "error"] as const),
            ...paginationFlags({ defaultPerPage: 25 }),
          },
          run: ({ args, flags }) => {
            captured = { args, flags };
          },
        }),
      ],
    });

    const { ctx } = createContext(["logs", "list", "gateway"], {
      q: "timeout",
      level: "error",
      page: "2",
      "per-page": "10",
    });

    await mod.run(ctx);
    expect(captured).toEqual({
      args: { source: "gateway" },
      flags: { search: "timeout", level: "error", page: 2, perPage: 10 },
    });
  });

  test("parses repeated string list flags and boolean aliases", async () => {
    let captured: unknown;
    const mod = defineCliCommands({
      name: "admin",
      summary: "Admin commands",
      commands: [
        command("webhooks create", {
          summary: "Create webhook",
          flags: {
            sendOn: flag.stringList({ name: "send-on" }),
            yes: confirmFlag(),
          },
          run: ({ flags }) => {
            captured = flags;
          },
        }),
      ],
    });

    expect(mod.booleanFlags).toContain("yes");
    await mod.run(createContext(["webhooks", "create"], { "send-on": ["error,recovery", "warn"], yes: true }).ctx);
    expect(captured).toEqual({ sendOn: ["error", "recovery", "warn"], yes: true });
  });

  test("does not collect colliding value flags as module-level booleans", async () => {
    let captured: unknown;
    const mod = defineCliCommands({
      name: "notes",
      summary: "Note commands",
      commands: [
        command("read", {
          summary: "Read note",
          flags: { content: flag.boolean({ description: "Include content" }) },
          run: ({ flags }) => {
            captured = flags;
          },
        }),
        command("edit", {
          summary: "Edit note",
          flags: { content: flag.string({ description: "Markdown content" }) },
          run: ({ flags }) => {
            captured = flags;
          },
        }),
      ],
    });

    expect(mod.booleanFlags).not.toContain("content");

    await mod.run(createContext(["edit"], { content: "hello" }).ctx);
    expect(captured).toEqual({ content: "hello" });

    await mod.run(createContext(["read"], { content: true }).ctx);
    expect(captured).toEqual({ content: true });
  });

  test("renders root, subtree, command, and flag help", async () => {
    const mod = defineCliCommands({
      name: "admin",
      summary: "Admin commands",
      commands: [
        command("logs list", {
          summary: "List logs",
          flags: { search: flag.string({ aliases: ["q"], description: "Free-text search" }) },
          examples: ["cld admin logs list --search timeout"],
          run: () => undefined,
        }),
      ],
    });

    expect(mod.help?.()).toContain("cld admin");

    const subtree = createContext(["logs", "help"]);
    await mod.run(subtree.ctx);
    expect(subtree.lines.join("\n")).toContain("cld admin logs");

    const commandHelp = createContext(["logs", "list"], { help: true });
    await mod.run(commandHelp.ctx);
    const output = commandHelp.lines.join("\n");
    expect(output).toContain("cld admin logs list");
    expect(output).toContain("--search <value>, --q");
    expect(output).toContain("cld admin logs list --search timeout");
  });

  test("rejects missing args, invalid ints, invalid enums, and unknown flags", async () => {
    const mod = defineCliCommands({
      name: "admin",
      summary: "Admin commands",
      commands: [
        command("logs get", {
          summary: "Get log",
          args: { id: arg.required() },
          flags: {
            page: flag.int({ min: 1 }),
            level: flag.enum(["info", "warn", "error"] as const),
          },
          run: () => undefined,
        }),
      ],
    });

    await expect(mod.run(createContext(["logs", "get"]).ctx)).rejects.toThrow("Missing id");
    await expect(mod.run(createContext(["logs", "get", "1"], { page: "0" }).ctx)).rejects.toThrow("--page must be at least 1");
    await expect(mod.run(createContext(["logs", "get", "1"], { level: "debug" }).ctx)).rejects.toThrow(
      "--level must be one of: info, warn, error",
    );
    await expect(mod.run(createContext(["logs", "get", "1"], { nope: "x" }).ctx)).rejects.toThrow("Unknown flag");
  });

  test("detects conflicting input sources", async () => {
    const mod = defineCliCommands({
      name: "admin",
      summary: "Admin commands",
      commands: [
        command("announcements create", {
          summary: "Create announcement",
          flags: { body: flag.input({ required: true }) },
          run: async ({ flags }) => {
            await readCliInput(flags.body, { required: true });
          },
        }),
      ],
    });

    await expect(mod.run(createContext(["announcements", "create"], { body: "hello", "body-file": "body.md" }).ctx)).rejects.toThrow(
      "Pass only one of --body, --body-file, or --stdin",
    );
  });
});
