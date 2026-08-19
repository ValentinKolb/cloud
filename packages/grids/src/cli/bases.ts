import { arg, command, confirmFlag, flag, paginationFlags } from "@valentinkolb/cloud/cli";
import type { PublicBase as Base, PublicField as Field, PublicTable as Table } from "../api/public-dto";
import {
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  type RetentionPolicy,
  type RetentionPreview,
} from "../retention-policy-contracts";
import {
  baseArgs,
  baseFlag,
  baseRows,
  GRIDS_BASE_DEFAULT_KEY,
  listBases,
  requireDefaultBaseRef,
  resolveBase,
  resolveBaseFromCommand,
} from "./resources";
import {
  applyDefined,
  JSON_BODY_INPUT,
  jsonRequest,
  type MessageResponse,
  printCliStructured,
  printJsonOrMessage,
  printJsonOrTable,
  readApi,
  readJsonInput,
} from "./runtime";

type TrashedForm = {
  id: string;
  tableId: string;
  name: string;
  deletedAt: string | null;
};

type BaseTrash = {
  tables: Table[];
  fields: Field[];
  forms: TrashedForm[];
};

type RetentionPolicyResponse = { policy: RetentionPolicy | null };

const trashRows = (trash: BaseTrash) => [
  ...trash.tables.map((item) => ({ kind: "table", name: item.name, parent: "-", deletedAt: item.deletedAt, id: item.id })),
  ...trash.fields.map((item) => ({
    kind: "field",
    name: item.name,
    parent: item.tableId,
    deletedAt: item.deletedAt,
    id: item.id,
  })),
  ...trash.forms.map((item) => ({
    kind: "form",
    name: item.name,
    parent: item.tableId,
    deletedAt: item.deletedAt,
    id: item.id,
  })),
];

export const baseCrudCommands = [
  command("list", {
    summary: "List Grids bases",
    flags: {
      q: flag.string({ aliases: ["query"], description: "Search bases" }),
      ...paginationFlags({ defaultPerPage: 100, maxPerPage: 500 }),
    },
    async run({ ctx, flags }) {
      const perPage = flags.perPage ?? 100;
      const page = flags.page ?? 1;
      const payload = await listBases(ctx, { q: flags.q, limit: perPage, offset: (page - 1) * perPage });
      printJsonOrTable(ctx, payload, baseRows(payload.items), [
        { key: "id", label: "ID" },
        { key: "name", label: "NAME" },
        { key: "description", label: "DESCRIPTION" },
        { key: "updatedAt", label: "UPDATED" },
      ]);
    },
  }),
  command("use", {
    summary: "Set the default Grids base",
    args: { base: arg.required({ description: "Base public id or exact name" }) },
    async run({ ctx, args }) {
      const base = await resolveBase(ctx, args.base);
      const id = base.id;
      await ctx.setDefault(GRIDS_BASE_DEFAULT_KEY, id);
      printJsonOrMessage(ctx, { base, defaultBase: id }, `Using Grids base ${base.name} (${id}).`);
    },
  }),
  command("current", {
    summary: "Show the default Grids base",
    async run({ ctx }) {
      const base = await resolveBase(ctx, await requireDefaultBaseRef(ctx));
      const id = base.id;
      printJsonOrMessage(ctx, { base, defaultBase: id }, `${base.name} (${id})`);
    },
  }),
  command("bases list", {
    summary: "List Grids bases",
    flags: {
      q: flag.string({ aliases: ["query"], description: "Search bases" }),
      ...paginationFlags({ defaultPerPage: 100, maxPerPage: 500 }),
    },
    async run({ ctx, flags }) {
      const perPage = flags.perPage ?? 100;
      const page = flags.page ?? 1;
      const payload = await listBases(ctx, { q: flags.q, limit: perPage, offset: (page - 1) * perPage });
      printJsonOrTable(ctx, payload, baseRows(payload.items), [
        { key: "id", label: "ID" },
        { key: "name", label: "NAME" },
        { key: "description", label: "DESCRIPTION" },
        { key: "updatedAt", label: "UPDATED" },
      ]);
    },
  }),
  command("bases get", {
    summary: "Show a Grids base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      if (!printCliStructured(ctx, base)) {
        ctx.print(`${base.name} (${base.id})`);
        if (base.description) ctx.print(base.description);
        ctx.print(`id: ${base.id}`);
        ctx.print(`updated: ${base.updatedAt}`);
      }
    },
  }),
  command("bases trash", {
    summary: "List deleted resources that can be restored in a base",
    description:
      "Requires base admin access. Parent tables contain their own deleted fields and forms, so nested items are not duplicated.",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const trash = await readApi<BaseTrash>(ctx, `/bases/${encodeURIComponent(base.id)}/trash`);
      printJsonOrTable(ctx, trash, trashRows(trash), [
        { key: "kind", label: "TYPE" },
        { key: "name", label: "NAME" },
        { key: "parent", label: "PARENT TABLE" },
        { key: "deletedAt", label: "DELETED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("bases retention", {
    summary: "Show the Record retention floor for a Grids base",
    description: "Requires base admin access. The floor preserves trashed Records but never deletes them or starts cleanup.",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const payload = await readApi<RetentionPolicyResponse>(ctx, `/bases/${encodeURIComponent(base.id)}/retention-policy`);
      if (!printCliStructured(ctx, payload)) {
        ctx.print(
          payload.policy
            ? `Minimum Record retention for ${base.name} (${base.id}): ${payload.policy.minimumDays} days in trash.`
            : `No minimum Record retention is configured for ${base.name} (${base.id}).`,
        );
      }
    },
  }),
  command("bases retention preview", {
    summary: "Preview a Record retention floor for a Grids base",
    description: "Returns a bounded impact at one observation time. Reaching the floor never deletes a Record.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      days: flag.int({ required: true, min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS, description: "Minimum days in trash" }),
    },
    async run({ ctx, args, flags }) {
      const minimumDays = flags.days;
      if (minimumDays === undefined) throw new Error("Pass --days <number>.");
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const preview = await readApi<RetentionPreview>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/retention-policy/preview`,
        jsonRequest("POST", { minimumDays }),
      );
      if (printCliStructured(ctx, preview)) return;
      ctx.print(
        `${preview.counts.retainedUntilLater} retained until later; ${preview.counts.floorReached} reached the floor; ${preview.counts.protectedFinalized} finalized and independently protected; ${preview.counts.trashedRecords} total in trash.`,
      );
      ctx.print(`Observed ${preview.observedAt}.${preview.truncated ? " Example list is bounded." : ""}`);
      if (preview.examples.length > 0) {
        ctx.table(preview.examples, [
          { key: "recordId", label: "RECORD" },
          { key: "tableId", label: "TABLE" },
          { key: "deletedAt", label: "TRASHED" },
          { key: "notBefore", label: "FLOOR REACHED" },
        ]);
      }
    },
  }),
  command("bases retention set", {
    summary: "Set the Record retention floor for a Grids base",
    description: "Requires --yes only when shortening an existing floor. Saving never deletes Records or starts cleanup.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      days: flag.int({ required: true, min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS, description: "Minimum days in trash" }),
      yes: confirmFlag("Shorten the existing Record retention floor"),
    },
    async run({ ctx, args, flags }) {
      const minimumDays = flags.days;
      if (minimumDays === undefined) throw new Error("Pass --days <number>.");
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const current = await readApi<RetentionPolicyResponse>(ctx, `/bases/${encodeURIComponent(base.id)}/retention-policy`);
      if (current.policy && minimumDays < current.policy.minimumDays && !flags.yes) {
        throw new Error("Pass --yes to shorten the existing Record retention floor.");
      }
      const updated = await readApi<RetentionPolicyResponse>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/retention-policy`,
        jsonRequest("PUT", { minimumDays }),
      );
      printJsonOrMessage(ctx, updated, `Minimum Record retention for ${base.name} (${base.id}) set to ${minimumDays} days in trash.`);
    },
  }),
  command("bases retention remove", {
    summary: "Remove the Record retention floor from a Grids base",
    description: "Removing the floor may allow future controlled destruction earlier. It does not delete anything now.",
    args: baseArgs,
    flags: { ...baseFlag, yes: confirmFlag("Remove the Record retention floor") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to remove the Record retention floor.");
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      await readApi<void>(ctx, `/bases/${encodeURIComponent(base.id)}/retention-policy`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { removed: true, baseId: base.id }, `Removed minimum Record retention from ${base.name} (${base.id}).`);
    },
  }),
  command("bases create", {
    summary: "Create a Grids base",
    args: { name: arg.required({ description: "Base name" }) },
    flags: {
      description: flag.string({ description: "Base description" }),
      use: flag.boolean({ description: "Use the new base as default" }),
    },
    async run({ ctx, args, flags }) {
      const base = await readApi<Base>(ctx, "/bases", jsonRequest("POST", { name: args.name, description: flags.description ?? null }));
      const id = base.id;
      if (flags.use) await ctx.setDefault(GRIDS_BASE_DEFAULT_KEY, id);
      printJsonOrMessage(ctx, base, `Created ${base.name} (${id}).${flags.use ? " Using it as default." : ""}`);
    },
  }),
  command("bases update", {
    summary: "Update a Grids base",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Base name" }),
      description: flag.string({ description: "Base description" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "base update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
      });
      const updated = await readApi<Base>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated ${updated.name} (${updated.id}).`);
    },
  }),
  command("bases delete", {
    summary: "Delete a Grids base",
    args: baseArgs,
    flags: { ...baseFlag, yes: confirmFlag("Delete this Grids base") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      await readApi<MessageResponse>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: base.id }, `Deleted ${base.name} (${base.id}).`);
    },
  }),
  command("bases restore", {
    summary: "Restore a deleted Grids base",
    args: { base: arg.required({ description: "Base public id" }) },
    async run({ ctx, args }) {
      const restored = await readApi<Base>(ctx, `/bases/${encodeURIComponent(args.base)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, restored, `Restored ${restored.name} (${restored.id}).`);
    },
  }),
];
