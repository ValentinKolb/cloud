import { createHash } from "node:crypto";
import type { Tool, ToolContext, ToolResolver } from "@k2b/nessi";
import { z } from "zod";
import {
  createHelpCatalog,
  HELP_READ_MAX_CHARS,
  HELP_SEARCH_MAX_LIMIT,
  readHelpCatalog,
  searchHelpCatalog,
} from "../_internal/help-catalog";
import {
  type CapabilityActionManifest,
  type CapabilityActionReview,
  type CapabilityQueryManifest,
  CloudResourceRefSchema,
  cloudResourceRefAppId,
  resolveCapabilityResourceReader,
} from "../contracts/capabilities";
import type { CapabilityRegistryEntry, HelpRegistryEntry } from "../contracts/registry";
import type { RequestActor } from "../server";
import { defineAiTool, type PreparedAiTools, prepareAiTools } from "./tools";
import type { AiConversationStore, AiRuntimeTool, AiToolPresentation } from "./types";

export type AiCapabilityKind = "query" | "action";

export type AiCapabilityCatalogItem = {
  name: string;
  appId: string;
  appName: string;
  appDescription: string;
  kind: AiCapabilityKind;
  title: string;
  description: string;
};

export type AiCapabilityAppCatalogItem = {
  appId: string;
  appName: string;
  description: string;
};

export type AiCapabilityCatalogEntry = AiCapabilityCatalogItem & {
  app: CapabilityRegistryEntry;
  operation: CapabilityQueryManifest | CapabilityActionManifest;
};

export type AiRememberableCapabilityApprovals = ReadonlyMap<string, string>;

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_APP_LIST_LIMIT = 20;
const MAX_APP_LIST_LIMIT = 25;
const MAX_APP_DIRECTORY_DESCRIPTION_CHARS = 2_000;
const MAX_UNAVAILABLE_LOADED_NAMES = 10;

const providerSafeSegment = (value: string): string =>
  [...value]
    .map((character) => {
      if (/^[a-zA-Z0-9-]$/.test(character)) return character;
      if (character === "_") return "__";
      if (character === ".") return "_dot_";
      return `_u${character.codePointAt(0)!.toString(16)}_`;
    })
    .join("");

/** Readable, collision-safe name within the strictest common provider limit. */
export const aiCapabilityToolName = (appId: string, kind: AiCapabilityKind, localId: string): string => {
  const full = `${providerSafeSegment(appId)}__${kind}__${providerSafeSegment(localId)}`;
  if (full.length <= 64) return full;
  const suffix = createHash("sha256").update(full).digest("hex").slice(0, 12);
  return `${full.slice(0, 50)}__${suffix}`;
};

const catalogItem = (entry: AiCapabilityCatalogEntry): AiCapabilityCatalogItem => ({
  name: entry.name,
  appId: entry.appId,
  appName: entry.appName,
  appDescription: entry.appDescription,
  kind: entry.kind,
  title: entry.title,
  description: entry.description,
});

/** Build the compact, deterministic directory of apps in the current live registry. */
export const buildAiCapabilityAppCatalog = (apps: readonly CapabilityRegistryEntry[]): AiCapabilityAppCatalogItem[] => {
  const seen = new Set<string>();
  return [...apps]
    .sort(
      (left, right) =>
        left.appId.localeCompare(right.appId) ||
        left.appName.localeCompare(right.appName) ||
        left.appDescription.localeCompare(right.appDescription) ||
        left.endpoint.localeCompare(right.endpoint),
    )
    .flatMap((app) => {
      if (seen.has(app.appId)) return [];
      seen.add(app.appId);
      return [{ appId: app.appId, appName: app.appName, description: app.appDescription }];
    });
};

/** Build one deterministic, immutable view of the current live registry. */
export const buildAiCapabilityCatalog = (apps: CapabilityRegistryEntry[]): AiCapabilityCatalogEntry[] => {
  const entries = [...apps]
    .sort(
      (left, right) =>
        left.appId.localeCompare(right.appId) ||
        left.manifest.manifestHash.localeCompare(right.manifest.manifestHash) ||
        left.appName.localeCompare(right.appName) ||
        left.endpoint.localeCompare(right.endpoint),
    )
    .flatMap((app) => [
      ...app.manifest.actions.map((operation) => ({ app, operation, kind: "action" as const })),
      ...app.manifest.queries.map((operation) => ({ app, operation, kind: "query" as const })),
    ])
    .map(
      ({ app, operation, kind }): AiCapabilityCatalogEntry => ({
        name: aiCapabilityToolName(app.appId, kind, operation.localId),
        appId: app.appId,
        appName: app.appName,
        appDescription: app.appDescription,
        kind,
        title: operation.title,
        description: operation.description,
        app,
        operation,
      }),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
};

const filteredCatalog = (
  catalog: readonly AiCapabilityCatalogEntry[],
  input: { appId?: string; kind?: AiCapabilityKind },
): AiCapabilityCatalogEntry[] =>
  catalog.filter((entry) => (!input.appId || entry.appId === input.appId) && (!input.kind || entry.kind === input.kind));

const boundedLimit = (value: number | undefined, fallback: number, maximum: number): number => {
  if (!Number.isInteger(value) || Number(value) <= 0) return fallback;
  return Math.min(Number(value), maximum);
};

export const listAiCapabilities = (
  catalog: readonly AiCapabilityCatalogEntry[],
  input: { appId?: string; kind?: AiCapabilityKind; cursor?: string; limit?: number },
): { capabilities: AiCapabilityCatalogItem[]; page: { hasMore: boolean; nextCursor?: string } } => {
  const filtered = filteredCatalog(catalog, input);
  const start = input.cursor ? filtered.findIndex((entry) => entry.name > input.cursor!) : 0;
  const offset = start < 0 ? filtered.length : start;
  const limit = boundedLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + page.length < filtered.length;
  return {
    capabilities: page.map(catalogItem),
    page: {
      hasMore,
      ...(hasMore && page.length > 0 ? { nextCursor: page.at(-1)!.name } : {}),
    },
  };
};

export const listAiCapabilityApps = (
  apps: readonly AiCapabilityAppCatalogItem[],
  input: { cursor?: string; limit?: number },
): { apps: AiCapabilityAppCatalogItem[]; page: { hasMore: boolean; nextCursor?: string } } => {
  const start = input.cursor ? apps.findIndex((app) => app.appId > input.cursor!) : 0;
  const offset = start < 0 ? apps.length : start;
  const limit = boundedLimit(input.limit, DEFAULT_APP_LIST_LIMIT, MAX_APP_LIST_LIMIT);
  const page = apps.slice(offset, offset + limit);
  const hasMore = offset + page.length < apps.length;
  return {
    apps: [...page],
    page: {
      hasMore,
      ...(hasMore && page.length > 0 ? { nextCursor: page.at(-1)!.appId } : {}),
    },
  };
};

const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const searchTerms = (value: string): string[] => {
  const terms = normalizeSearchText(value).split(" ").filter(Boolean);
  const meaningful = terms.filter((term) => term.length >= 2);
  return [...new Set(meaningful.length > 0 ? meaningful : terms)];
};

const searchTermForms = (term: string): string[] => {
  const forms = new Set([term]);
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) forms.add(term.slice(0, -1));
  if (term.length > 4 && term.endsWith("es")) forms.add(term.slice(0, -2));
  if (term.length > 4 && term.endsWith("ies")) forms.add(`${term.slice(0, -3)}y`);
  return [...forms];
};

const searchWordForms = (value: string): Set<string> => new Set(searchTerms(value).flatMap(searchTermForms));

const includesSearchTerm = (words: ReadonlySet<string>, term: string): boolean => searchTermForms(term).some((form) => words.has(form));

const includesSearchPhrase = (text: string, phrase: string): boolean => ` ${text} `.includes(` ${phrase} `);

export const searchAiCapabilities = (
  catalog: readonly AiCapabilityCatalogEntry[],
  input: { query: string; appId?: string; kind?: AiCapabilityKind; limit?: number },
): { capabilities: AiCapabilityCatalogItem[] } => {
  const phrase = normalizeSearchText(input.query);
  const terms = searchTerms(input.query);
  if (!phrase || terms.length === 0) return { capabilities: [] };
  const limit = boundedLimit(input.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const matches = filteredCatalog(catalog, input)
    .flatMap((entry) => {
      const name = normalizeSearchText(entry.name);
      const title = normalizeSearchText(entry.title);
      const identity = `${name} ${title}`;
      const app = normalizeSearchText(`${entry.appId} ${entry.appName}`);
      const appDescription = normalizeSearchText(entry.appDescription);
      const description = normalizeSearchText(entry.description);
      const identityWords = searchWordForms(identity);
      const appWords = searchWordForms(app);
      const appDescriptionWords = searchWordForms(appDescription);
      const descriptionWords = searchWordForms(description);
      let matchedTerms = 0;
      let score = 0;
      if (name === phrase || title === phrase) score += 100;
      else if (includesSearchPhrase(identity, phrase)) score += 50;
      if (app === phrase) score += 40;
      else if (includesSearchPhrase(app, phrase)) score += 20;
      if (includesSearchPhrase(appDescription, phrase)) score += 12;
      if (includesSearchPhrase(description, phrase)) score += 15;
      for (const term of terms) {
        const identityMatch = includesSearchTerm(identityWords, term);
        const appMatch = includesSearchTerm(appWords, term);
        const appDescriptionMatch = includesSearchTerm(appDescriptionWords, term);
        const descriptionMatch = includesSearchTerm(descriptionWords, term);
        if (identityMatch || appMatch || appDescriptionMatch || descriptionMatch) matchedTerms += 1;
        if (identityMatch) score += 8;
        if (appMatch) score += 6;
        if (appDescriptionMatch) score += 3;
        if (descriptionMatch) score += 4;
      }
      return matchedTerms > 0 ? [{ entry, matchedTerms, score }] : [];
    })
    .sort(
      (left, right) =>
        right.matchedTerms - left.matchedTerms || right.score - left.score || left.entry.name.localeCompare(right.entry.name),
    )
    .slice(0, limit);
  return { capabilities: matches.map(({ entry }) => catalogItem(entry)) };
};

const AiHelpCatalogItemSchema = z
  .object({
    appId: z.string(),
    appName: z.string(),
    kind: z.literal("help"),
    documentId: z.string(),
    title: z.string(),
    description: z.string().optional(),
  })
  .strict();

const AiHelpDocumentSchema = AiHelpCatalogItemSchema.extend({
  markdown: z.string().max(HELP_READ_MAX_CHARS),
  truncated: z.boolean(),
}).strict();

/** Search and read the live Help snapshot without loading one tool per article. */
export const createAiHelpTools = (registry: readonly HelpRegistryEntry[]): AiRuntimeTool[] => {
  const documents = createHelpCatalog(registry);

  const search = defineAiTool({
    name: "search_help",
    description:
      "Search installed Cloud app Help when product behavior, settings, workflows, permissions, or app errors are unclear. Use 1-3 concise English product terms and scope appId when known. Returns compact document ids for read_help; skip this tool for straightforward live-data requests.",
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(200).describe("Product task or concept to find."),
        appId: z.string().trim().min(1).optional().describe("Optional exact Cloud app id."),
        limit: z.number().int().min(1).max(HELP_SEARCH_MAX_LIMIT).optional(),
      })
      .strict(),
    outputSchema: z.object({ documents: z.array(AiHelpCatalogItemSchema).max(HELP_SEARCH_MAX_LIMIT) }).strict(),
    approval: "never",
  }).server(async ({ query, appId, limit }) => ({
    documents: searchHelpCatalog(documents, { query, appId, limit: boundedLimit(limit, DEFAULT_SEARCH_LIMIT, HELP_SEARCH_MAX_LIMIT) }),
  }));

  const read = defineAiTool({
    name: "read_help",
    description:
      "Read the best matching Cloud app Help article returned by search_help. Pass the same concise search terms so long articles return the relevant bounded sections. Product Help guides behavior but never proves live access or action success.",
    inputSchema: z
      .object({
        appId: z.string().trim().min(1).describe("Exact Cloud app id."),
        documentId: z.string().trim().min(1).describe("Exact Help document id."),
        query: z.string().trim().min(1).max(200).optional().describe("The concise terms used to find the article."),
      })
      .strict(),
    outputSchema: z.object({ document: AiHelpDocumentSchema.nullable() }).strict(),
    approval: "never",
  }).server(async ({ appId, documentId, query }) => ({
    document: readHelpCatalog(documents, { appId, documentId, query }),
  }));

  return [search, read];
};

const resolveHelpRegistry = async (
  listRegistry: () => Promise<HelpRegistryEntry[]>,
  onError?: (error: unknown) => void,
): Promise<HelpRegistryEntry[]> => {
  try {
    return await listRegistry();
  } catch (error) {
    onError?.(error);
    return [];
  }
};

const resolveCapabilityRegistry = async (
  listRegistry: () => Promise<CapabilityRegistryEntry[]>,
  onError?: (error: unknown) => void,
): Promise<CapabilityRegistryEntry[]> => {
  try {
    return await listRegistry();
  } catch (error) {
    onError?.(error);
    return [];
  }
};

/** Resolve the live Help corpus on every provider turn without coupling it to executable app capabilities. */
export const createAiHelpToolResolver =
  (input: {
    conversationId: string;
    actor: RequestActor;
    staticTools: AiRuntimeTool[];
    listRegistry: () => Promise<HelpRegistryEntry[]>;
    onRegistryError?: (error: unknown) => void;
  }): ToolResolver =>
  async (): Promise<Tool[]> => {
    const registry = await resolveHelpRegistry(input.listRegistry, input.onRegistryError);
    return prepareAiTools({
      tools: [...input.staticTools, ...createAiHelpTools(registry)],
      actor: input.actor,
      conversationId: input.conversationId,
    }).tools;
  };

const SCHEMA_KEYS = new Set([
  "$ref",
  "type",
  "description",
  "format",
  "enum",
  "const",
  "properties",
  "required",
  "items",
  "prefixItems",
  "additionalProperties",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "nullable",
  "$defs",
  "definitions",
]);

const reduceSchemaValue = (value: unknown, key?: string): unknown => {
  if (key === "const") return structuredClone(value);
  if (Array.isArray(value)) {
    if (key === "required" || key === "enum" || key === "type") return structuredClone(value);
    return value.map((item) => reduceSchemaValue(item));
  }
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (key === "properties" || key === "$defs" || key === "definitions") {
      output[childKey] = reduceSchemaValue(childValue);
      continue;
    }
    if (!SCHEMA_KEYS.has(childKey)) continue;
    output[childKey] = reduceSchemaValue(childValue, childKey);
  }
  return output;
};

/** Keep the provider-useful shape while leaving authoritative validation in the target app. */
export const reduceAiCapabilityInputSchema = (schema: Record<string, unknown>): Record<string, unknown> =>
  reduceSchemaValue(schema) as Record<string, unknown>;

export const aiCapabilityInputSchema = (schema: Record<string, unknown>): z.ZodType =>
  z.fromJSONSchema(reduceAiCapabilityInputSchema(schema));

const CatalogItemSchema = z
  .object({
    name: z.string(),
    appId: z.string(),
    appName: z.string(),
    appDescription: z.string(),
    kind: z.enum(["query", "action"]),
    title: z.string(),
    description: z.string(),
  })
  .strict();

const AppCatalogItemSchema = z
  .object({
    appId: z.string(),
    appName: z.string(),
    description: z.string(),
  })
  .strict();

type CapabilityStateStore = Pick<AiConversationStore, "loadCapabilities">;

export const createAiCapabilityMetaTools = (input: {
  apps: readonly CapabilityRegistryEntry[];
  catalog: readonly AiCapabilityCatalogEntry[];
  conversationId: string;
  store: CapabilityStateStore;
  maxLoadedCapabilities?: number;
  unavailableLoadedNames?: readonly string[];
}): AiRuntimeTool[] => {
  const apps = buildAiCapabilityAppCatalog(input.apps);
  const directoryEntries: string[] = [];
  let directoryLength = 0;
  for (const app of apps) {
    const entry = `${app.appId} (${app.appName})`;
    const addedLength = entry.length + (directoryEntries.length > 0 ? 2 : 0);
    if (directoryLength + addedLength > MAX_APP_DIRECTORY_DESCRIPTION_CHARS) break;
    directoryEntries.push(entry);
    directoryLength += addedLength;
  }
  const hiddenAppCount = apps.length - directoryEntries.length;
  const liveAppDirectory =
    directoryEntries.length > 0
      ? ` Live capability apps: ${directoryEntries.join(", ")}${hiddenAppCount > 0 ? `, and ${hiddenAppCount} more` : ""}.`
      : " No live capability apps are visible in this provider turn; retry discovery later instead of claiming a permanent product limitation.";
  const unavailableLoadedNames = input.unavailableLoadedNames ?? [];
  const unavailableLoadedNotice =
    unavailableLoadedNames.length > 0
      ? ` Previously loaded capabilities currently absent from the live registry: ${unavailableLoadedNames
          .slice(-MAX_UNAVAILABLE_LOADED_NAMES)
          .join(", ")}${
          unavailableLoadedNames.length > MAX_UNAVAILABLE_LOADED_NAMES
            ? `, and ${unavailableLoadedNames.length - MAX_UNAVAILABLE_LOADED_NAMES} more`
            : ""
        }. Treat them as temporarily unavailable; do not infer a permanent product limitation or search repeatedly.`
      : "";
  const search = defineAiTool({
    name: "search_capabilities",
    description: `Search installed Cloud app capabilities by concise task terms, app name, app description, or operation metadata.${liveAppDirectory} When the app is known, set its exact appId on the first attempt. Use list_capability_apps for app descriptions. Set kind to query for reads and action for mutations. If one scoped attempt has no relevant result, try at most one broader search, then stop. Returns compact exact names for loading.${unavailableLoadedNotice}`,
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(200).describe("What the capability should do."),
        appId: z.string().trim().min(1).optional().describe("Optional exact Cloud app id."),
        kind: z.enum(["query", "action"]).optional().describe("Use query for reading or searching and action for mutations."),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      })
      .strict(),
    outputSchema: z.object({ capabilities: z.array(CatalogItemSchema).max(MAX_SEARCH_LIMIT) }).strict(),
    approval: "never",
  }).server(async (args) => searchAiCapabilities(input.catalog, args));

  const listApps = defineAiTool({
    name: "list_capability_apps",
    description:
      "List the live Cloud apps that currently publish capabilities, including their exact app ids, names, and app descriptions. Use this only when the compact live directory is insufficient to identify the owning app.",
    inputSchema: z
      .object({
        cursor: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(MAX_APP_LIST_LIMIT).optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        apps: z.array(AppCatalogItemSchema).max(MAX_APP_LIST_LIMIT),
        page: z.object({ hasMore: z.boolean(), nextCursor: z.string().optional() }).strict(),
      })
      .strict(),
    approval: "never",
  }).server(async (args) => listAiCapabilityApps(apps, args));

  const list = defineAiTool({
    name: "list_capabilities",
    description: "List installed Cloud app capabilities, optionally filtered by app and query or action kind.",
    inputSchema: z
      .object({
        appId: z.string().trim().min(1).optional().describe("Optional exact Cloud app id."),
        kind: z.enum(["query", "action"]).optional(),
        cursor: z.string().max(300).optional(),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        capabilities: z.array(CatalogItemSchema).max(MAX_LIST_LIMIT),
        page: z.object({ hasMore: z.boolean(), nextCursor: z.string().optional() }).strict(),
      })
      .strict(),
    approval: "never",
  }).server(async (args) => listAiCapabilities(input.catalog, args));

  const load = defineAiTool({
    name: "load_capabilities",
    description: "Load exact capability names returned by search_capabilities or list_capabilities as ordinary tools for the next turn.",
    inputSchema: z.object({ names: z.array(z.string().trim().min(1)).min(1).max(25) }).strict(),
    outputSchema: z
      .object({
        loaded: z.array(z.string()),
        alreadyLoaded: z.array(z.string()),
        missing: z.array(z.string()),
        evicted: z.array(z.string()),
      })
      .strict(),
    approval: "never",
  }).server(async ({ names }) => {
    const available = new Set(input.catalog.map((entry) => entry.name));
    const requested = [...new Set(names)];
    const valid = requested.filter((name) => available.has(name));
    const missing = requested.filter((name) => !available.has(name));
    const updated = await input.store.loadCapabilities({
      conversationId: input.conversationId,
      names: valid,
      maxLoadedCapabilities: input.maxLoadedCapabilities,
    });
    return { ...updated, missing };
  });

  return [search, listApps, list, load];
};

export const createLoadedAiCapabilityTools = (input: {
  catalog: readonly AiCapabilityCatalogEntry[];
  loadedNames: readonly string[];
  review?: (entry: AiCapabilityCatalogEntry, args: unknown, context: ToolContext) => Promise<CapabilityActionReview | null>;
  execute: (entry: AiCapabilityCatalogEntry, args: unknown, context: ToolContext) => Promise<unknown>;
}): AiRuntimeTool[] => {
  const byName = new Map(input.catalog.map((entry) => [entry.name, entry]));
  return input.loadedNames.flatMap((name) => {
    const entry = byName.get(name);
    if (!entry) return [];
    return [
      defineAiTool({
        name: entry.name,
        description: `${entry.title}. ${entry.description} Never retry ACTION_OUTCOME_UNKNOWN. Do not retry unchanged after INTERNAL or INVALID_APP_RESPONSE; report the provider error.`,
        inputSchema: aiCapabilityInputSchema(entry.operation.inputSchema),
        outputSchema: z.unknown(),
        // Capability Actions request a custom, non-rememberable approval after
        // their optional live review has resolved.
        approval: "never",
      }).server(async (args, context) => {
        if (entry.kind === "action") {
          const review = (await input.review?.(entry, args, context)) ?? null;
          const message = review
            ? [
                review.message,
                ...(review.details ?? []).map((detail) => `${detail.label}: ${detail.value}`),
                ...(review.links ?? []).map((link) => `${link.title ?? link.rel}: ${link.href}`),
              ].join("\n")
            : `${entry.appName}: ${entry.title}\nReview the validated arguments below before running this Action.`;
          if (!(await context.requestApproval(message))) throw new Error("Capability Action was rejected by the user.");
        }
        return input.execute(entry, args, context);
      }),
    ];
  });
};

export const createAiResourceReaderTool = (input: {
  apps: readonly CapabilityRegistryEntry[];
  catalog: readonly AiCapabilityCatalogEntry[];
  execute: (entry: AiCapabilityCatalogEntry, args: unknown, context: ToolContext) => Promise<unknown>;
}): AiRuntimeTool =>
  defineAiTool({
    name: "read_cloud_resource",
    description:
      "Read a Cloud resource from its structured reference using the resource type's current canonical reader. Use this for refs returned by search, Projects, or other capabilities.",
    inputSchema: CloudResourceRefSchema,
    outputSchema: z.unknown(),
    approval: "never",
  }).server(async (ref, context) => {
    const appId = cloudResourceRefAppId(ref);
    const app = input.apps.find((candidate) => candidate.appId === appId);
    const reader = app ? resolveCapabilityResourceReader(app.manifest, ref) : null;
    if (!reader) throw new Error(`Cloud resource type ${ref.type} is unknown or has no reader.`);
    const entry = input.catalog.find(
      (candidate) => candidate.appId === appId && candidate.kind === "query" && candidate.operation.localId === reader.localId,
    );
    if (!entry) throw new Error(`Cloud resource reader ${appId}.${reader.localId} is unavailable.`);
    return input.execute(entry, { id: ref.id }, context);
  });

/** Nessi resolver: one registry/load-state snapshot is used for both provider schemas and execution in each turn. */
export const createAiCapabilityToolResolver =
  (input: {
    conversationId: string;
    actor: RequestActor;
    staticTools: AiRuntimeTool[];
    store: Pick<AiConversationStore, "getLoadedCapabilities" | "loadCapabilities">;
    listRegistry: () => Promise<CapabilityRegistryEntry[]>;
    onCapabilityRegistryError?: (error: unknown) => void;
    listHelpRegistry?: () => Promise<HelpRegistryEntry[]>;
    onHelpRegistryError?: (error: unknown) => void;
    maxLoadedCapabilities?: number;
    execute: (entry: AiCapabilityCatalogEntry, args: unknown, context: ToolContext) => Promise<unknown>;
    review?: (entry: AiCapabilityCatalogEntry, args: unknown, context: ToolContext) => Promise<CapabilityActionReview | null>;
    onPrepared?: (snapshot: {
      prepared: PreparedAiTools;
      presentations: Map<string, AiToolPresentation>;
      rememberableApprovals: AiRememberableCapabilityApprovals;
    }) => void;
  }): ToolResolver =>
  async (): Promise<Tool[]> => {
    const [registry, persistedLoadedNames, helpRegistry] = await Promise.all([
      resolveCapabilityRegistry(input.listRegistry, input.onCapabilityRegistryError),
      input.store.getLoadedCapabilities({ conversationId: input.conversationId }),
      input.listHelpRegistry ? resolveHelpRegistry(input.listHelpRegistry, input.onHelpRegistryError) : [],
    ]);
    const configuredLimit = Math.floor(input.maxLoadedCapabilities ?? 0);
    const loadedNames = configuredLimit > 0 ? persistedLoadedNames.slice(-configuredLimit) : persistedLoadedNames;
    if (loadedNames.length !== persistedLoadedNames.length) {
      await input.store.loadCapabilities({
        conversationId: input.conversationId,
        names: [],
        maxLoadedCapabilities: configuredLimit,
      });
    }
    const catalog = buildAiCapabilityCatalog(registry);
    const catalogNames = new Set(catalog.map((entry) => entry.name));
    const unavailableLoadedNames = loadedNames.filter((name) => !catalogNames.has(name));
    const capabilityTools = [
      ...createAiCapabilityMetaTools({
        apps: registry,
        catalog,
        conversationId: input.conversationId,
        store: input.store,
        maxLoadedCapabilities: input.maxLoadedCapabilities,
        unavailableLoadedNames,
      }),
      ...(input.listHelpRegistry ? createAiHelpTools(helpRegistry) : []),
      createAiResourceReaderTool({ apps: registry, catalog, execute: input.execute }),
      ...createLoadedAiCapabilityTools({ catalog, loadedNames, review: input.review, execute: input.execute }),
    ];
    const prepared = prepareAiTools({
      tools: [...input.staticTools, ...capabilityTools],
      actor: input.actor,
      conversationId: input.conversationId,
    });
    const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
    const presentations = new Map<string, AiToolPresentation>();
    const rememberableApprovals = new Map<string, string>();
    for (const name of loadedNames) {
      const entry = catalogByName.get(name);
      if (!entry) continue;
      presentations.set(name, {
        kind: "capability",
        appId: entry.appId,
        appName: entry.appName,
        appIcon: entry.app.appIcon,
        appAccent: entry.app.appAccent,
        title: entry.title,
        capabilityKind: entry.kind,
      });
      if (entry.kind === "action" && "approval" in entry.operation && entry.operation.approval === "rememberable") {
        rememberableApprovals.set(name, `${entry.appId}.${entry.operation.localId}`);
      }
    }
    input.onPrepared?.({ prepared, presentations, rememberableApprovals });
    return prepared.tools;
  };
