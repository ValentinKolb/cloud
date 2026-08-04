import { createHash } from "node:crypto";
import type { Tool, ToolContext, ToolResolver } from "@k2b/nessi";
import { z } from "zod";
import type { CapabilityActionManifest, CapabilityActionReview, CapabilityQueryManifest } from "../contracts/capabilities";
import type { CapabilityRegistryEntry, HelpRegistryEntry } from "../contracts/registry";
import type { RequestActor } from "../server";
import { markdownToPlainText } from "../shared/markdown";
import { defineAiTool, type PreparedAiTools, prepareAiTools } from "./tools";
import type { AiConversationStore, AiRuntimeTool, AiToolPresentation } from "./types";

export type AiCapabilityKind = "query" | "action";

export type AiCapabilityCatalogItem = {
  name: string;
  appId: string;
  appName: string;
  kind: AiCapabilityKind;
  title: string;
  description: string;
};

export type AiCapabilityCatalogEntry = AiCapabilityCatalogItem & {
  app: CapabilityRegistryEntry;
  operation: CapabilityQueryManifest | CapabilityActionManifest;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const MAX_HELP_MARKDOWN_CHARS = 128 * 1024;

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
  kind: entry.kind,
  title: entry.title,
  description: entry.description,
});

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
      const description = normalizeSearchText(entry.description);
      const identityWords = searchWordForms(identity);
      const appWords = searchWordForms(app);
      const descriptionWords = searchWordForms(description);
      let matchedTerms = 0;
      let score = 0;
      if (name === phrase || title === phrase) score += 100;
      else if (includesSearchPhrase(identity, phrase)) score += 50;
      if (app === phrase) score += 40;
      else if (includesSearchPhrase(app, phrase)) score += 20;
      if (includesSearchPhrase(description, phrase)) score += 15;
      for (const term of terms) {
        const identityMatch = includesSearchTerm(identityWords, term);
        const appMatch = includesSearchTerm(appWords, term);
        const descriptionMatch = includesSearchTerm(descriptionWords, term);
        if (identityMatch || appMatch || descriptionMatch) matchedTerms += 1;
        if (identityMatch) score += 8;
        if (appMatch) score += 6;
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

const AiHelpDocumentSchema = AiHelpCatalogItemSchema.extend({ markdown: z.string().max(MAX_HELP_MARKDOWN_CHARS) }).strict();

/** Search and read the live Help snapshot without loading one tool per article. */
export const createAiHelpTools = (registry: readonly HelpRegistryEntry[]): AiRuntimeTool[] => {
  const documents = registry
    .flatMap((app) =>
      app.documents.map((document) => ({
        appId: app.appId,
        appName: app.appName,
        kind: "help" as const,
        documentId: document.id,
        title: document.title,
        description: document.description,
        markdown: document.markdown,
      })),
    )
    .sort((left, right) => left.appId.localeCompare(right.appId) || left.documentId.localeCompare(right.documentId));

  const search = defineAiTool({
    name: "search_help",
    description: "Search installed Cloud app Help by task, app, title, or article text. Returns compact document ids for read_help.",
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(200).describe("Product task or concept to find."),
        appId: z.string().trim().min(1).optional().describe("Optional exact Cloud app id."),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      })
      .strict(),
    outputSchema: z.object({ documents: z.array(AiHelpCatalogItemSchema).max(MAX_SEARCH_LIMIT) }).strict(),
    approval: "never",
  }).server(async ({ query, appId, limit }) => {
    const needle = query.trim().toLocaleLowerCase();
    const maximum = boundedLimit(limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    return {
      documents: documents
        .filter((document) => {
          if (appId && document.appId !== appId) return false;
          return `${document.appId} ${document.appName} ${document.documentId} ${document.title} ${document.description ?? ""} ${markdownToPlainText(
            document.markdown,
          )}`
            .toLocaleLowerCase()
            .includes(needle);
        })
        .slice(0, maximum)
        .map(({ markdown: _markdown, ...document }) => document),
    };
  });

  const read = defineAiTool({
    name: "read_help",
    description: "Read one exact Cloud app Help article returned by search_help.",
    inputSchema: z
      .object({
        appId: z.string().trim().min(1).describe("Exact Cloud app id."),
        documentId: z.string().trim().min(1).describe("Exact Help document id."),
      })
      .strict(),
    outputSchema: z.object({ document: AiHelpDocumentSchema.nullable() }).strict(),
    approval: "never",
  }).server(async ({ appId, documentId }) => ({
    document: documents.find((document) => document.appId === appId && document.documentId === documentId) ?? null,
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
    kind: z.enum(["query", "action"]),
    title: z.string(),
    description: z.string(),
  })
  .strict();

type CapabilityStateStore = Pick<AiConversationStore, "loadCapabilities">;

export const createAiCapabilityMetaTools = (input: {
  catalog: readonly AiCapabilityCatalogEntry[];
  conversationId: string;
  store: CapabilityStateStore;
  maxLoadedCapabilities?: number;
}): AiRuntimeTool[] => {
  const search = defineAiTool({
    name: "search_capabilities",
    description:
      "Search installed Cloud app capabilities by concise task terms, app, or name. Set kind to query for reads and action for mutations. Returns compact exact names for loading.",
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

  return [search, list, load];
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
    onPrepared?: (snapshot: { prepared: PreparedAiTools; presentations: Map<string, AiToolPresentation> }) => void;
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
    const capabilityTools = [
      ...createAiCapabilityMetaTools({
        catalog,
        conversationId: input.conversationId,
        store: input.store,
        maxLoadedCapabilities: input.maxLoadedCapabilities,
      }),
      ...(input.listHelpRegistry ? createAiHelpTools(helpRegistry) : []),
      ...createLoadedAiCapabilityTools({ catalog, loadedNames, review: input.review, execute: input.execute }),
    ];
    const prepared = prepareAiTools({
      tools: [...input.staticTools, ...capabilityTools],
      actor: input.actor,
      conversationId: input.conversationId,
    });
    const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
    const presentations = new Map<string, AiToolPresentation>();
    for (const name of loadedNames) {
      const entry = catalogByName.get(name);
      if (!entry) continue;
      presentations.set(name, {
        kind: "capability",
        appId: entry.appId,
        appName: entry.appName,
        appIcon: entry.app.appIcon,
        title: entry.title,
        capabilityKind: entry.kind,
      });
    }
    input.onPrepared?.({ prepared, presentations });
    return prepared.tools;
  };
