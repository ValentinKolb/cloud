import { arg, command, confirmFlag, flag } from "@valentinkolb/cloud/cli";
import type { PulseSource, PulseSourceScrape, SourceKind } from "../contracts";
import { listSources, requireRestArg, resolveBaseFromCommand, resolveSource } from "./context";
import { baseFlag, sourceKindFlag } from "./flags";
import { scrapeRows, sourceRows } from "./rows";
import { jsonRequest, printJsonOrTable, printMessage, readApi } from "./shared";

type IngestResult = { metrics: number; events: number; states: number };

export const sourceCommands = [
  command("sources list", {
    summary: "List Pulse sources",
    flags: baseFlag,
    args: { args: arg.rest({ valueLabel: "base" }) },
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const sources = await listSources(ctx, base.id);
      printJsonOrTable(ctx, sources, sourceRows(sources), [
        { key: "id" },
        { key: "name" },
        { key: "kind" },
        { key: "enabled" },
        { key: "interval" },
        { key: "token" },
        { key: "lastSeenAt" },
      ]);
    },
  }),
  command("sources create", {
    summary: "Create a Pulse source",
    flags: {
      ...baseFlag,
      name: flag.string({ required: true, description: "Source name" }),
      kind: sourceKindFlag,
      endpointUrl: flag.string({ name: "endpoint-url", description: "Metrics endpoint URL" }),
      bearerToken: flag.string({ name: "bearer-token", description: "Metrics endpoint bearer token" }),
      scrapeIntervalSeconds: flag.int({ name: "scrape-interval-seconds", min: 10, max: 86400, description: "Scrape interval" }),
    },
    args: { args: arg.rest({ valueLabel: "base" }) },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const source = await readApi<PulseSource>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/sources`,
        jsonRequest("POST", {
          kind: flags.kind as SourceKind,
          name: flags.name,
          endpointUrl: flags.endpointUrl ?? null,
          bearerToken: flags.bearerToken ?? null,
          scrapeIntervalSeconds: flags.scrapeIntervalSeconds ?? null,
        }),
      );
      if (ctx.options.output === "json") ctx.json(source);
      else ctx.print(`Created source ${source.name} (${source.id}).`);
    },
  }),
  command("sources update", {
    summary: "Update a Pulse source",
    flags: {
      ...baseFlag,
      name: flag.string({ description: "New source name" }),
      enabled: flag.enum(["true", "false"], { description: "Enable or disable the source" }),
      endpointUrl: flag.string({ name: "endpoint-url", description: "Metrics endpoint URL" }),
      bearerToken: flag.string({ name: "bearer-token", description: "New bearer token" }),
      scrapeIntervalSeconds: flag.int({ name: "scrape-interval-seconds", min: 10, max: 86400, description: "Scrape interval" }),
    },
    args: { args: arg.rest({ valueLabel: "base source", required: true }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
      const updated = await readApi<PulseSource>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}`,
        jsonRequest("PATCH", {
          name: flags.name,
          enabled: flags.enabled === undefined ? undefined : flags.enabled === "true",
          endpointUrl: flags.endpointUrl,
          bearerToken: flags.bearerToken,
          scrapeIntervalSeconds: flags.scrapeIntervalSeconds,
        }),
      );
      if (ctx.options.output === "json") ctx.json(updated);
      else ctx.print(`Updated source ${updated.name} (${updated.id}).`);
    },
  }),
  command("sources delete", {
    summary: "Delete a Pulse source",
    flags: { ...baseFlag, yes: confirmFlag("Delete this source") },
    args: { args: arg.rest({ valueLabel: "base source", required: true }) },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Refusing to delete without --yes.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
      await readApi<unknown>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}`,
        jsonRequest("DELETE"),
      );
      printMessage(ctx, { deleted: source.id }, `Deleted source ${source.name}.`);
    },
  }),
  command("sources scrape", {
    summary: "Scrape a metrics source now",
    flags: baseFlag,
    args: { args: arg.rest({ valueLabel: "base source", required: true }) },
    async run({ ctx, args }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
      const result = await readApi<IngestResult>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/scrape`,
        jsonRequest("POST"),
      );
      printJsonOrTable(ctx, result, [result], [{ key: "metrics" }, { key: "events" }, { key: "states" }]);
    },
  }),
  command("sources scrapes", {
    summary: "List recent scrape attempts for a source",
    flags: baseFlag,
    args: { args: arg.rest({ valueLabel: "base source", required: true }) },
    async run({ ctx, args }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
      const scrapes = await readApi<PulseSourceScrape[]>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/scrapes`,
      );
      printJsonOrTable(ctx, scrapes, scrapeRows(scrapes), [
        { key: "success" },
        { key: "finishedAt" },
        { key: "data" },
        { key: "durationMs" },
        { key: "error" },
      ]);
    },
  }),
];
