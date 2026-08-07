import { writeFile } from "node:fs/promises";
import { command, confirmFlag, flag, printStructured } from "@valentinkolb/cloud/cli";
import type { CustomAppDefinition } from "../custom-apps/contracts";
import type { CustomApp, CustomAppPlan } from "../service/custom-apps";
import { baseArgs, baseFlag, resolveBaseFromCommand } from "./resources";
import { exactMatch, jsonRequest, printJsonOrMessage, printJsonOrTable, readApi, readTextInput, requireRestArg } from "./runtime";

const sourceFlag = flag.input({
  name: "source",
  fileName: "source-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "yaml",
  required: true,
  description: "Custom App YAML or JSON definition",
});

const appFlag = { app: flag.string({ description: "Custom App UUID, short id, or exact name" }) };

export const listCustomApps = (ctx: Parameters<typeof readApi>[0], baseId: string): Promise<CustomApp[]> =>
  readApi<CustomApp[]>(ctx, `/apps/by-base/${encodeURIComponent(baseId)}`);

export const resolveCustomApp = async (ctx: Parameters<typeof readApi>[0], baseId: string, reference: string): Promise<CustomApp> =>
  exactMatch(
    await listCustomApps(ctx, baseId),
    reference,
    [(app) => app.id, (app) => app.shortId, (app) => app.name],
    "Custom App",
    (app) => `${app.name} (${app.shortId})`,
  );

const resolveAppFromCommand = async (
  ctx: Parameters<typeof readApi>[0],
  args: string[],
  appReference: string | undefined,
): Promise<{ app: CustomApp }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, appReference ? 0 : 1);
  return { app: await resolveCustomApp(ctx, base.id, appReference ?? requireRestArg(rest, 0, "Custom App")) };
};

const readDefinition = async (input: Parameters<typeof readTextInput>[0], expectedBaseId: string): Promise<CustomAppDefinition> => {
  const source = await readTextInput(input, "Custom App definition", true);
  let definition: CustomAppDefinition;
  try {
    definition = Bun.YAML.parse(source!) as CustomAppDefinition;
  } catch (error) {
    throw new Error(`Invalid Custom App YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!definition || typeof definition !== "object") throw new Error("Custom App definition must be a YAML mapping.");
  if (definition.baseId !== expectedBaseId) throw new Error("Custom App baseId does not match the selected base.");
  return definition;
};

const printValidation = (
  ctx: Parameters<typeof readApi>[0],
  result: { valid: boolean; diagnostics: Array<{ path: Array<string | number>; message: string }>; capabilities?: unknown },
) => {
  if (printStructured(ctx, result)) return;
  if (result.valid) {
    ctx.print("Custom App definition is valid.");
    return;
  }
  for (const diagnostic of result.diagnostics) ctx.print(`${diagnostic.path.join(".") || "definition"}: ${diagnostic.message}`);
};

const printPlan = (ctx: Parameters<typeof readApi>[0], result: CustomAppPlan) => {
  if (!printStructured(ctx, result)) {
    ctx.print(`action: ${result.action}`);
    for (const change of result.changes) ctx.print(`- ${change}`);
    for (const diagnostic of result.diagnostics) ctx.print(`${diagnostic.path.join(".") || "definition"}: ${diagnostic.message}`);
  }
  if (!result.valid) throw new Error("Custom App definition is invalid.");
};

export const customAppCommands = [
  command("apps reference", {
    summary: "Show the strict Custom App definition reference",
    async run({ ctx }) {
      const reference = await readApi<unknown>(ctx, "/apps/reference");
      if (!printStructured(ctx, reference)) ctx.print(Bun.YAML.stringify(reference));
    },
  }),
  command("apps list", {
    summary: "List Custom Apps in a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const apps = await listCustomApps(ctx, base.id);
      printJsonOrTable(
        ctx,
        apps,
        apps.map((app) => ({
          shortId: app.shortId,
          name: app.name,
          state: app.publishedAt ? "published" : "draft",
          updatedAt: app.updatedAt,
          id: app.id,
        })),
        [
          { key: "shortId", label: "SHORT" },
          { key: "name", label: "NAME" },
          { key: "state", label: "STATE" },
          { key: "updatedAt", label: "UPDATED" },
          { key: "id", label: "ID" },
        ],
      );
    },
  }),
  command("apps get", {
    summary: "Show a Custom App",
    args: baseArgs,
    flags: { ...baseFlag, ...appFlag },
    async run({ ctx, args, flags }) {
      const { app } = await resolveAppFromCommand(ctx, args.args, flags.app);
      if (!printStructured(ctx, app)) {
        ctx.print(`${app.name} (${app.shortId})`);
        ctx.print(`state: ${app.publishedAt ? "published" : "draft"}`);
        ctx.print(`id: ${app.id}`);
      }
    },
  }),
  command("apps validate", {
    summary: "Validate and compile a Custom App definition without saving it",
    args: baseArgs,
    flags: { ...baseFlag, source: sourceFlag },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const definition = await readDefinition(flags.source, base.id);
      const result = await readApi<{
        valid: boolean;
        diagnostics: Array<{ path: Array<string | number>; message: string }>;
        capabilities?: unknown;
      }>(ctx, "/apps/validate", jsonRequest("POST", { definition }));
      printValidation(ctx, result);
      if (!result.valid) throw new Error("Custom App definition is invalid.");
    },
  }),
  command("apps plan", {
    summary: "Show the deterministic changes for a Custom App definition",
    args: baseArgs,
    flags: { ...baseFlag, source: sourceFlag },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const definition = await readDefinition(flags.source, base.id);
      const result = await readApi<CustomAppPlan>(ctx, "/apps/plan", jsonRequest("POST", { definition }));
      printPlan(ctx, result);
    },
  }),
  command("apps apply", {
    summary: "Create or update a Custom App draft from its definition",
    args: baseArgs,
    flags: {
      ...baseFlag,
      source: sourceFlag,
      dryRun: flag.boolean({ name: "dry-run", description: "Show the plan without changing the draft" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const definition = await readDefinition(flags.source, base.id);
      if (flags.dryRun) {
        const result = await readApi<CustomAppPlan>(ctx, "/apps/plan", jsonRequest("POST", { definition }));
        printPlan(ctx, result);
        return;
      }
      const app = await readApi<CustomApp>(ctx, "/apps/apply", jsonRequest("POST", { definition }));
      printJsonOrMessage(ctx, app, `Applied ${app.name} (${app.shortId}) as a draft.`);
    },
  }),
  command("apps export", {
    summary: "Export the current Custom App draft as deterministic YAML",
    args: baseArgs,
    flags: { ...baseFlag, ...appFlag, out: flag.string({ description: "Write YAML to this file" }) },
    async run({ ctx, args, flags }) {
      const { app } = await resolveAppFromCommand(ctx, args.args, flags.app);
      const definition = await readApi<CustomAppDefinition>(ctx, `/apps/${encodeURIComponent(app.id)}/export`);
      if (ctx.options.output === "json") return ctx.json(definition);
      if (ctx.options.output === "jsonl") return ctx.jsonLine(definition);
      const yaml = Bun.YAML.stringify(definition);
      if (!flags.out) return ctx.print(yaml);
      await writeFile(flags.out, yaml);
      ctx.print(`Wrote ${flags.out}.`);
    },
  }),
  command("apps publish", {
    summary: "Publish the current validated Custom App draft",
    args: baseArgs,
    flags: { ...baseFlag, ...appFlag, yes: confirmFlag("Publish this Custom App") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to publish.");
      const { app } = await resolveAppFromCommand(ctx, args.args, flags.app);
      const published = await readApi<CustomApp>(ctx, `/apps/${encodeURIComponent(app.id)}/publish`, jsonRequest("POST"));
      printJsonOrMessage(ctx, published, `Published ${published.name} at /apps/${published.shortId}.`);
    },
  }),
  command("apps unpublish", {
    summary: "Remove the published Custom App snapshot while keeping its draft",
    args: baseArgs,
    flags: { ...baseFlag, ...appFlag, yes: confirmFlag("Unpublish this Custom App") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to unpublish.");
      const { app } = await resolveAppFromCommand(ctx, args.args, flags.app);
      const unpublished = await readApi<CustomApp>(ctx, `/apps/${encodeURIComponent(app.id)}/unpublish`, jsonRequest("POST"));
      printJsonOrMessage(ctx, unpublished, `Unpublished ${unpublished.name}; its draft is unchanged.`);
    },
  }),
  command("apps delete", {
    summary: "Delete a Custom App and remove its published route",
    args: baseArgs,
    flags: { ...baseFlag, ...appFlag, yes: confirmFlag("Delete this Custom App") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { app } = await resolveAppFromCommand(ctx, args.args, flags.app);
      await readApi<unknown>(ctx, `/apps/${encodeURIComponent(app.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { id: app.id }, `Deleted ${app.name} (${app.shortId}).`);
    },
  }),
];
