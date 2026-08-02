import type { Result, ServiceError } from "@k2b/stdlib";
import { z } from "zod";
import type { AccessSubject, RequestActor, User } from "./shared";

export const CAPABILITY_PROTOCOL_VERSION = 1 as const;

const CAPABILITY_LOCAL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CAPABILITY_QUALIFIED_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CLOUD_LINK_BASE_URL = "https://cloud.invalid";

const isSameOriginCloudPath = (value: string): boolean => {
  if (!value.startsWith("/")) return false;
  try {
    return new URL(value, CLOUD_LINK_BASE_URL).origin === CLOUD_LINK_BASE_URL;
  } catch {
    return false;
  }
};

export const CapabilityLocalIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(CAPABILITY_LOCAL_ID_PATTERN, "Use a stable lower-case capability id");

export const CapabilityQualifiedIdSchema = z
  .string()
  .min(3)
  .max(180)
  .regex(CAPABILITY_QUALIFIED_ID_PATTERN, "Expected a namespaced capability id such as contacts.contact");

export const CloudResourceRefSchema = z
  .object({
    type: CapabilityQualifiedIdSchema.describe("Namespaced resource type declared by the owning app."),
    id: z.string().min(1).max(512).describe("Stable app-owned resource identifier."),
  })
  .strict();

export type CloudResourceRef = z.infer<typeof CloudResourceRefSchema>;

export const CapabilitySemanticLinkSchema = z
  .object({
    rel: z.enum(["open", "edit", "status", "preview", "download"]).describe("Semantic relationship; clients decide how to present it."),
    href: z
      .string()
      .min(1)
      .max(2048)
      .refine(isSameOriginCloudPath, "Capability links must be root-relative same-origin Cloud paths")
      .describe("Root-relative Cloud URL."),
    title: z.string().min(1).max(120).optional().describe("Optional human-readable link label."),
  })
  .strict();

export type CapabilitySemanticLink = z.infer<typeof CapabilitySemanticLinkSchema>;

export const CapabilityActionReviewSchema = z
  .object({
    message: z.string().min(1).max(1000).describe("Plain-text description of the concrete Action consequence."),
    details: z
      .array(
        z
          .object({
            label: z.string().min(1).max(120),
            value: z.string().max(10_000),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    links: z.array(CapabilitySemanticLinkSchema).max(10).optional(),
  })
  .strict();

export type CapabilityActionReview = z.infer<typeof CapabilityActionReviewSchema>;

export const CapabilityPageSchema = z
  .object({
    nextCursor: z.string().min(1).max(2048).optional().describe("Opaque cursor for the next page."),
    hasMore: z.boolean().describe("Whether another page is available."),
  })
  .strict();

export type CapabilityPage = z.infer<typeof CapabilityPageSchema>;

export const capabilityResultSchema = <T extends z.ZodType>(data: T) =>
  z
    .object({
      data,
      refs: z.array(CloudResourceRefSchema).max(100).optional(),
      page: CapabilityPageSchema.optional(),
      links: z.array(CapabilitySemanticLinkSchema).max(20).optional(),
    })
    .strict();

export type CapabilityResult<T> = {
  data: T;
  refs?: CloudResourceRef[];
  page?: CapabilityPage;
  links?: CapabilitySemanticLink[];
};

export const CapabilityErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1000),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CapabilityError = ServiceError & { details?: Record<string, unknown> };
export type CapabilityInvocationResult<T> = Result<CapabilityResult<T>, CapabilityError>;
export type CapabilityActionReviewResult = Result<CapabilityActionReview, CapabilityError>;

export const CloudResourceViewSchema = z
  .object({
    ref: CloudResourceRefSchema.describe("Stable identity of the result."),
    title: z.string().min(1).max(500).describe("Primary result label."),
    preview: z.string().max(2000).optional().describe("Short plain-text result preview."),
    icon: z.string().min(1).max(120).optional().describe("Optional presentation icon."),
    priority: z.number().int().min(0).max(9).optional().describe("App-local relevance hint from zero to nine."),
    metadata: z
      .array(
        z
          .object({
            label: z.string().min(1).max(120),
            value: z.string().max(1000),
          })
          .strict(),
      )
      .max(20)
      .optional()
      .describe("Small structured metadata shown with the result."),
    links: z.array(CapabilitySemanticLinkSchema).min(1).max(10).describe("Semantic links for the resource."),
  })
  .strict();

export type CloudResourceView = z.infer<typeof CloudResourceViewSchema>;

export const UniversalSearchInputSchema = z
  .object({
    query: z.string().max(500).describe("User-entered search text. Empty text is allowed when a facet narrows the query."),
    tags: z.array(z.string().min(1).max(64)).max(20).describe("Canonical search facets supported by this query."),
    limit: z.number().int().min(1).max(100).describe("Maximum number of results to return."),
  })
  .strict();

export type UniversalSearchInput = z.infer<typeof UniversalSearchInputSchema>;

export const UniversalSearchDataSchema = z.array(CloudResourceViewSchema).max(100);
export type UniversalSearchData = z.infer<typeof UniversalSearchDataSchema>;

export type CapabilityExecutionContext = {
  actor: RequestActor;
  accessSubject: AccessSubject;
  user: User | null;
  idempotencyKey?: string;
  signal: AbortSignal;
};

export type CapabilityResourceTypeDefinition = {
  title: string;
  description: string;
  icon?: string;
};

export type CapabilitySearchTagDefinition = {
  tag: string;
  title: string;
  description: string;
  aliases?: readonly string[];
};

export type CapabilityUniversalSearchDefinition = {
  tags: readonly CapabilitySearchTagDefinition[];
};

export type CapabilityQueryDefinition<Input extends z.ZodType = z.ZodType<any>, Data extends z.ZodType = z.ZodType<any>> = {
  title: string;
  description: string;
  input: Input;
  data: Data;
  openWorld: boolean;
  universalSearch?: CapabilityUniversalSearchDefinition;
  run: (
    input: z.output<Input>,
    context: CapabilityExecutionContext,
  ) => CapabilityInvocationResult<z.output<Data>> | Promise<CapabilityInvocationResult<z.output<Data>>>;
};

export type CapabilityApprovalPolicy = "never" | "once" | "always";
export type CapabilityIdempotencyPolicy = "none" | "optional" | "required";

export type CapabilityActionDefinition<Input extends z.ZodType = z.ZodType<any>, Data extends z.ZodType = z.ZodType<any>> = {
  title: string;
  description: string;
  input: Input;
  data: Data;
  destructive: boolean;
  openWorld: boolean;
  /** Uses the same never/once/always semantics as Cloud AI tool approval. */
  approval: CapabilityApprovalPolicy;
  idempotency: CapabilityIdempotencyPolicy;
  target?: { type: string; inputField: string };
  review?: (
    input: z.output<Input>,
    context: CapabilityExecutionContext,
  ) => CapabilityActionReviewResult | Promise<CapabilityActionReviewResult>;
  run: (
    input: z.output<Input>,
    context: CapabilityExecutionContext,
  ) => CapabilityInvocationResult<z.output<Data>> | Promise<CapabilityInvocationResult<z.output<Data>>>;
};

type CapabilityCatalog<T> = Readonly<Record<string, T>>;

export type CapabilityDefinitions = {
  version: typeof CAPABILITY_PROTOCOL_VERSION;
  types?: CapabilityCatalog<CapabilityResourceTypeDefinition>;
  queries?: CapabilityCatalog<CapabilityQueryDefinition>;
  actions?: CapabilityCatalog<CapabilityActionDefinition>;
};

/**
 * Declares one app's public capability surface. Runtime compilation happens
 * in defineApp.start(), where the app id is available for namespacing.
 */
export const defineCapabilities = <const T extends CapabilityDefinitions>(definitions: T): T => definitions;

export const CapabilityResourceTypeManifestSchema = z
  .object({
    id: CapabilityQualifiedIdSchema,
    localId: CapabilityLocalIdSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    icon: z.string().min(1).max(120).optional(),
  })
  .strict();

export const CapabilitySearchTagManifestSchema = z
  .object({
    tag: z.string().min(1).max(64),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    aliases: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .strict();

const CapabilityOperationManifestBaseSchema = z
  .object({
    id: CapabilityQualifiedIdSchema,
    localId: CapabilityLocalIdSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    inputSchema: z.record(z.string(), z.unknown()),
    resultSchema: z.record(z.string(), z.unknown()),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const CapabilityQueryManifestSchema = CapabilityOperationManifestBaseSchema.extend({
  openWorld: z.boolean(),
  universalSearch: z
    .object({ tags: z.array(CapabilitySearchTagManifestSchema).max(100) })
    .strict()
    .optional(),
}).strict();

export const CapabilityActionManifestSchema = CapabilityOperationManifestBaseSchema.extend({
  destructive: z.boolean(),
  openWorld: z.boolean(),
  approval: z.enum(["never", "once", "always"]),
  idempotency: z.enum(["none", "optional", "required"]),
  target: z
    .object({ type: CapabilityQualifiedIdSchema, inputField: z.string().min(1).max(100) })
    .strict()
    .optional(),
  review: z.literal(true).optional(),
}).strict();

export const CapabilityManifestSchema = z
  .object({
    protocolVersion: z.literal(CAPABILITY_PROTOCOL_VERSION),
    appId: z.string().min(1).max(80),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    types: z.array(CapabilityResourceTypeManifestSchema).max(200),
    queries: z.array(CapabilityQueryManifestSchema).max(200),
    actions: z.array(CapabilityActionManifestSchema).max(200),
  })
  .strict();

export type CapabilityResourceTypeManifest = z.infer<typeof CapabilityResourceTypeManifestSchema>;
export type CapabilityQueryManifest = z.infer<typeof CapabilityQueryManifestSchema>;
export type CapabilityActionManifest = z.infer<typeof CapabilityActionManifestSchema>;
export type CapabilitySearchTagManifest = z.infer<typeof CapabilitySearchTagManifestSchema>;
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
