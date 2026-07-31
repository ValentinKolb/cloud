import { arg, type CliInputFlagValue, type CloudCliContext, command, defineCliCommands, flag, readCliInput } from "./index";

type CatalogResponse = {
  protocolVersion: 1;
  apps: Array<{
    appId: string;
    appName: string;
    manifest: { types: unknown[]; queries: unknown[]; actions: unknown[] };
  }>;
  page: { nextCursor?: string; hasMore: boolean };
};

const parseInput = async (input: CliInputFlagValue): Promise<unknown> => {
  const raw = await readCliInput(input, {
    label: "capability JSON input",
    required: true,
  });
  try {
    return JSON.parse(raw ?? "") as unknown;
  } catch {
    throw new Error("Capability input must be valid JSON.");
  }
};

const printGenericResult = (ctx: CloudCliContext, value: unknown): void => {
  if (ctx.options.output === "json") ctx.json(value);
  else if (ctx.options.output === "jsonl") ctx.jsonLine(value);
  else ctx.print(JSON.stringify(value, null, 2));
};

const invoke = async (config: {
  ctx: CloudCliContext;
  kind: "queries" | "actions";
  appId: string;
  capabilityId: string;
  input: CliInputFlagValue;
  idempotencyKey?: string;
}) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (config.idempotencyKey) headers.set("idempotency-key", config.idempotencyKey);
  const response = await config.ctx.fetch(
    `/api/capabilities/v1/${config.kind}/${encodeURIComponent(config.appId)}/${encodeURIComponent(config.capabilityId)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ input: await parseInput(config.input) }),
    },
  );
  printGenericResult(config.ctx, await config.ctx.readJson<unknown>(response));
};

export default defineCliCommands({
  name: "capabilities",
  summary: "Discover and invoke versioned Cloud app capabilities.",
  commands: [
    command("catalog", {
      summary: "List live capability manifests",
      flags: {
        cursor: flag.string({ description: "Continue after this app id" }),
        limit: flag.int({
          default: 10,
          min: 1,
          max: 25,
          description: "Maximum live apps to return",
        }),
      },
      run: async ({ ctx, flags }) => {
        const query = new URLSearchParams({ limit: String(flags.limit ?? 10) });
        if (flags.cursor) query.set("cursor", flags.cursor);
        const result = await ctx.readJson<CatalogResponse>(await ctx.fetch(`/api/capabilities/v1/catalog?${query}`));
        if (ctx.options.output === "json" || ctx.options.output === "jsonl") {
          printGenericResult(ctx, result);
          return;
        }
        ctx.table(
          result.apps.map((app) => ({
            app: app.appId,
            name: app.appName,
            types: app.manifest.types.length,
            queries: app.manifest.queries.length,
            actions: app.manifest.actions.length,
          })),
          [
            { key: "app", label: "APP" },
            { key: "name", label: "NAME" },
            { key: "types", label: "TYPES" },
            { key: "queries", label: "QUERIES" },
            { key: "actions", label: "ACTIONS" },
          ],
        );
        if (result.page.nextCursor) ctx.error(`More apps available; continue with --cursor ${result.page.nextCursor}`);
      },
    }),
    command("query", {
      summary: "Invoke a read-only app query",
      args: {
        appId: arg.required({ description: "Owning app id" }),
        queryId: arg.required({ description: "App-local query id" }),
      },
      flags: {
        input: flag.input({
          required: true,
          description: "Strict JSON input; supports --input-file or --stdin",
        }),
      },
      run: ({ ctx, args, flags }) =>
        invoke({
          ctx,
          kind: "queries",
          appId: args.appId,
          capabilityId: args.queryId,
          input: flags.input,
        }),
    }),
    command("action", {
      summary: "Invoke an app mutation",
      args: {
        appId: arg.required({ description: "Owning app id" }),
        actionId: arg.required({ description: "App-local action id" }),
      },
      flags: {
        input: flag.input({
          required: true,
          description: "Strict JSON input; supports --input-file or --stdin",
        }),
        idempotencyKey: flag.string({
          name: "idempotency-key",
          required: true,
          description: "Stable key used to make retries safe",
        }),
      },
      run: ({ ctx, args, flags }) =>
        invoke({
          ctx,
          kind: "actions",
          appId: args.appId,
          capabilityId: args.actionId,
          input: flags.input,
          idempotencyKey: flags.idempotencyKey,
        }),
    }),
  ],
});
