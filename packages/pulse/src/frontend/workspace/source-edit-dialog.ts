import { prompts } from "@valentinkolb/cloud/ui";
import type { PulseSource } from "../../contracts";
import { normalizeEndpointInput, parseScrapeInterval } from "./helpers";

type SourceEditResult = Record<string, unknown> | null | undefined;
type SourceEditFields = Parameters<typeof prompts.form>[0]["fields"];
type SourceEditField = SourceEditFields[string];

const sourceNameField = (source: PulseSource): SourceEditField => ({
  type: "text",
  label: "Source name",
  description: "Shown in source lists and dashboard filters.",
  required: true,
  default: source.name,
});

const sourceEditFields = (source: PulseSource): SourceEditFields => {
  const fields: SourceEditFields = { name: sourceNameField(source) };
  if (source.kind !== "metrics") return fields;

  return {
    ...fields,
    endpointUrl: {
      type: "text",
      label: "Metrics endpoint URL",
      description: "Pulse scrapes this endpoint on the configured interval.",
      required: true,
      default: source.endpointUrl ?? "",
    },
    scrapeIntervalSeconds: {
      type: "text",
      label: "Scrape interval in seconds",
      description: "How often Pulse should fetch this metrics endpoint.",
      default: String(source.scrapeIntervalSeconds ?? 60),
    },
    bearerToken: {
      type: "text",
      label: "New bearer token",
      description: "Leave empty to keep the currently stored encrypted token.",
      placeholder: "Leave empty to keep unchanged",
    },
  };
};

const trimDialogString = (value: unknown): string => String(value ?? "").trim();

const sourceNameFromResult = (result: SourceEditResult): string | null => {
  const name = trimDialogString(result?.name);
  return name || null;
};

const endpointFromResult = (source: PulseSource, result: SourceEditResult): string | null => {
  const endpoint = trimDialogString(result?.endpointUrl) || source.endpointUrl?.trim() || "";
  return endpoint || null;
};

const scrapeIntervalFromResult = (source: PulseSource, result: SourceEditResult): number =>
  parseScrapeInterval(String(result?.scrapeIntervalSeconds ?? source.scrapeIntervalSeconds ?? 60));

const bearerTokenFromResult = (result: SourceEditResult): string | null => {
  const bearerToken = trimDialogString(result?.bearerToken);
  return bearerToken || null;
};

const metricsSourcePatchFromResult = (source: PulseSource, result: SourceEditResult): Record<string, unknown> | null => {
  const endpoint = endpointFromResult(source, result);
  if (!endpoint) return null;

  const patch: Record<string, unknown> = {
    endpointUrl: normalizeEndpointInput(endpoint),
    scrapeIntervalSeconds: scrapeIntervalFromResult(source, result),
  };
  const bearerToken = bearerTokenFromResult(result);
  if (bearerToken) patch.bearerToken = bearerToken;
  return patch;
};

const sourcePatchFromResult = (source: PulseSource, result: SourceEditResult): Record<string, unknown> | null => {
  const name = sourceNameFromResult(result);
  if (!name) return null;

  const patch: Record<string, unknown> = { name };
  if (source.kind !== "metrics") return patch;

  const metricsPatch = metricsSourcePatchFromResult(source, result);
  return metricsPatch ? { ...patch, ...metricsPatch } : null;
};

export const openSourceEditDialog = async (source: PulseSource): Promise<Record<string, unknown> | null> => {
  const result = await prompts.form({
    title: source.kind === "metrics" ? "Edit metrics source" : "Edit source",
    icon: source.kind === "metrics" ? "ti ti-plug" : "ti ti-pencil",
    fields: sourceEditFields(source),
    confirmText: "Save",
  });

  return sourcePatchFromResult(source, result);
};
