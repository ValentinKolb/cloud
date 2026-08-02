import { createHash } from "node:crypto";
import { isServiceError, type Result, type ServiceError } from "@k2b/stdlib";
import { z } from "zod";
import {
  CAPABILITY_PROTOCOL_VERSION,
  type CapabilityActionDefinition,
  type CapabilityActionManifest,
  type CapabilityActionReviewResult,
  CapabilityActionReviewSchema,
  type CapabilityDefinitions,
  type CapabilityExecutionContext,
  type CapabilityInvocationResult,
  CapabilityLocalIdSchema,
  type CapabilityManifest,
  CapabilityManifestSchema,
  type CapabilityQueryDefinition,
  type CapabilityQueryManifest,
  capabilityResultSchema,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "../contracts/capabilities";

type JsonSchema = Record<string, unknown>;
const MAX_CAPABILITY_MANIFEST_BYTES = 256 * 1024;

export type CompiledCapabilityQuery = {
  definition: CapabilityQueryDefinition;
  manifest: CapabilityQueryManifest;
  resultSchema: z.ZodType;
};

export type CompiledCapabilityAction = {
  definition: CapabilityActionDefinition;
  manifest: CapabilityActionManifest;
  resultSchema: z.ZodType;
};

export type CompiledCapabilities = {
  manifest: CapabilityManifest;
  typeIds: ReadonlySet<string>;
  queries: ReadonlyMap<string, CompiledCapabilityQuery>;
  actions: ReadonlyMap<string, CompiledCapabilityAction>;
};

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableJsonValue(entry)]),
  );
};

export const capabilityHash = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(stableJsonValue(value)))
    .digest("hex");

const assertText = (value: string, label: string, max: number): void => {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (value.length > max) throw new Error(`${label} must be at most ${max} characters`);
};

const projectSchema = (schema: z.ZodType, label: string): JsonSchema => {
  try {
    return z.toJSONSchema(schema) as JsonSchema;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not JSON-Schema-projectable: ${message}`);
  }
};

const assertClosedObjectInput = (schema: JsonSchema, label: string): void => {
  if (schema.type !== "object") throw new Error(`${label} must be a Zod object schema`);
  if (schema.additionalProperties !== false) throw new Error(`${label} must reject unknown properties`);
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return;
  for (const [field, definition] of Object.entries(properties)) {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) continue;
    const description = (definition as Record<string, unknown>).description;
    if (typeof description !== "string" || !description.trim()) {
      throw new Error(`${label}.${field} needs a concise Zod description`);
    }
  }
};

const qualifiedId = (appId: string, localId: string): string => `${appId}.${localId}`;

const assertLocalId = (localId: string, label: string): void => {
  const parsed = CapabilityLocalIdSchema.safeParse(localId);
  if (!parsed.success) throw new Error(`${label} key "${localId}" is invalid: ${parsed.error.issues[0]?.message ?? "invalid id"}`);
};

const normalizeSearchTags = (definition: CapabilityQueryDefinition, label: string) => {
  if (!definition.universalSearch) return undefined;
  const seen = new Set<string>();
  const tags = definition.universalSearch.tags.map((tag) => {
    assertText(tag.tag, `${label} search tag`, 64);
    assertText(tag.title, `${label} search tag title`, 120);
    assertText(tag.description, `${label} search tag description`, 500);
    const canonical = tag.tag.trim().toLowerCase();
    const aliases = [...new Set((tag.aliases ?? []).map((alias) => alias.trim().toLowerCase()))].filter(Boolean);
    for (const value of [canonical, ...aliases]) {
      if (!/^[^\s#]+$/.test(value)) throw new Error(`${label} search tag "${value}" is invalid`);
      if (seen.has(value)) throw new Error(`${label} declares duplicate search tag or alias "${value}"`);
      seen.add(value);
    }
    return {
      tag: canonical,
      title: tag.title.trim(),
      description: tag.description.trim(),
      ...(aliases.length > 0 ? { aliases } : {}),
    };
  });
  return { tags };
};

const compileOperationSchemas = (definition: CapabilityQueryDefinition | CapabilityActionDefinition, label: string) => {
  assertText(definition.title, `${label} title`, 120);
  assertText(definition.description, `${label} description`, 1000);
  const inputSchema = projectSchema(definition.input, `${label} input`);
  assertClosedObjectInput(inputSchema, `${label} input`);
  if (
    "idempotency" in definition &&
    Object.hasOwn((inputSchema.properties as Record<string, unknown> | undefined) ?? {}, "idempotencyKey")
  ) {
    throw new Error(`${label} input field "idempotencyKey" is reserved for capability transports`);
  }
  const resultZodSchema = capabilityResultSchema(definition.data);
  const dataSchema = projectSchema(definition.data, `${label} data`);
  const resultSchema = projectSchema(resultZodSchema, `${label} result`);
  return {
    inputSchema,
    dataSchema,
    resultSchema,
    resultZodSchema,
    schemaHash: capabilityHash({ inputSchema, resultSchema }),
  };
};

export const compileCapabilities = (appId: string, definitions: CapabilityDefinitions): CompiledCapabilities => {
  if (definitions.version !== CAPABILITY_PROTOCOL_VERSION) {
    throw new Error(`Unsupported capability protocol version ${String(definitions.version)}`);
  }

  const types = Object.entries(definitions.types ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([localId, definition]) => {
      assertLocalId(localId, "Resource type");
      assertText(definition.title, `Resource type ${localId} title`, 120);
      assertText(definition.description, `Resource type ${localId} description`, 500);
      return {
        id: qualifiedId(appId, localId),
        localId,
        title: definition.title.trim(),
        description: definition.description.trim(),
        ...(definition.icon ? { icon: definition.icon } : {}),
      };
    });
  const typeIds = new Set(types.map((type) => type.id));

  const queries = new Map<string, CompiledCapabilityQuery>();
  for (const [localId, definition] of Object.entries(definitions.queries ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    assertLocalId(localId, "Query");
    const label = `Query ${localId}`;
    const schemas = compileOperationSchemas(definition, label);
    if (definition.universalSearch) {
      const expectedInput = projectSchema(UniversalSearchInputSchema, "Universal Search input");
      const expectedData = projectSchema(UniversalSearchDataSchema, "Universal Search data");
      if (capabilityHash(schemas.inputSchema) !== capabilityHash(expectedInput)) {
        throw new Error(`${label} exposed through Universal Search must use UniversalSearchInputSchema`);
      }
      if (capabilityHash(schemas.dataSchema) !== capabilityHash(expectedData)) {
        throw new Error(`${label} exposed through Universal Search must use UniversalSearchDataSchema`);
      }
    }
    const manifest = {
      id: qualifiedId(appId, localId),
      localId,
      title: definition.title.trim(),
      description: definition.description.trim(),
      inputSchema: schemas.inputSchema,
      resultSchema: schemas.resultSchema,
      schemaHash: schemas.schemaHash,
      openWorld: definition.openWorld,
      universalSearch: normalizeSearchTags(definition, label),
    } satisfies CapabilityQueryManifest;
    queries.set(localId, {
      definition,
      manifest,
      resultSchema: schemas.resultZodSchema,
    });
  }
  const actions = new Map<string, CompiledCapabilityAction>();
  for (const [localId, definition] of Object.entries(definitions.actions ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    assertLocalId(localId, "Action");
    const label = `Action ${localId}`;
    const schemas = compileOperationSchemas(definition, label);
    let target: CapabilityActionManifest["target"];
    if (definition.target) {
      assertLocalId(definition.target.type, `${label} target type`);
      const targetType = qualifiedId(appId, definition.target.type);
      if (!typeIds.has(targetType)) throw new Error(`${label} targets undeclared resource type "${definition.target.type}"`);
      const properties = (schemas.inputSchema.properties as Record<string, unknown> | undefined) ?? {};
      if (!Object.hasOwn(properties, definition.target.inputField)) {
        throw new Error(`${label} target input field "${definition.target.inputField}" is not declared by the action input`);
      }
      target = { type: targetType, inputField: definition.target.inputField };
    }
    const manifest = {
      id: qualifiedId(appId, localId),
      localId,
      title: definition.title.trim(),
      description: definition.description.trim(),
      inputSchema: schemas.inputSchema,
      resultSchema: schemas.resultSchema,
      schemaHash: schemas.schemaHash,
      destructive: definition.destructive,
      openWorld: definition.openWorld,
      approval: definition.approval,
      idempotency: definition.idempotency,
      ...(target ? { target } : {}),
      ...(definition.review ? { review: true as const } : {}),
    } satisfies CapabilityActionManifest;
    actions.set(localId, {
      definition,
      manifest,
      resultSchema: schemas.resultZodSchema,
    });
  }

  const manifestBase = {
    protocolVersion: CAPABILITY_PROTOCOL_VERSION,
    appId,
    types,
    queries: [...queries.values()].map((entry) => entry.manifest),
    actions: [...actions.values()].map((entry) => entry.manifest),
  };
  const manifest = CapabilityManifestSchema.parse({
    ...manifestBase,
    manifestHash: capabilityHash(manifestBase),
  });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)).byteLength;
  if (manifestBytes > MAX_CAPABILITY_MANIFEST_BYTES) {
    throw new Error(`Capability manifest exceeds the ${MAX_CAPABILITY_MANIFEST_BYTES}-byte registry limit`);
  }
  return { manifest, typeIds, queries, actions };
};

const resultRefs = (result: unknown): Array<{ type: string; id: string }> => {
  if (typeof result !== "object" || result === null) return [];
  const value = result as { refs?: unknown; data?: unknown };
  const refs = Array.isArray(value.refs) ? value.refs : [];
  const resources = UniversalSearchDataSchema.safeParse(value.data);
  if (!resources.success) return refs as Array<{ type: string; id: string }>;
  return [...(refs as Array<{ type: string; id: string }>), ...resources.data.map((entry) => entry.ref)] as Array<{
    type: string;
    id: string;
  }>;
};

export const validateCapabilityResult = (
  compiled: CompiledCapabilities,
  operation: CompiledCapabilityQuery | CompiledCapabilityAction,
  result: unknown,
): Result<unknown, ServiceError> => {
  const parsed = operation.resultSchema.safeParse(result);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "Capability returned an invalid result",
        status: 500,
      },
    };
  }
  for (const ref of resultRefs(parsed.data)) {
    if (!compiled.typeIds.has(ref.type)) {
      return {
        ok: false,
        error: {
          code: "INTERNAL",
          message: `Capability returned undeclared resource type ${ref.type}`,
          status: 500,
        },
      };
    }
  }
  return { ok: true, data: parsed.data };
};

export const invokeCompiledCapability = async (params: {
  compiled: CompiledCapabilities;
  kind: "query" | "action";
  localId: string;
  input: unknown;
  expectedSchemaHash: string | null;
  context: CapabilityExecutionContext;
  onUnexpectedError?: (error: unknown) => void;
}): Promise<CapabilityInvocationResult<unknown>> => {
  const operation = params.kind === "query" ? params.compiled.queries.get(params.localId) : params.compiled.actions.get(params.localId);
  if (!operation) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Capability ${params.kind} not found`,
        status: 404,
      },
    };
  }
  if (params.expectedSchemaHash !== operation.manifest.schemaHash) {
    return {
      ok: false,
      error: {
        code: "SCHEMA_MISMATCH",
        message: "Capability schema changed; refresh the live catalog and retry",
        status: 409,
        details: { expected: operation.manifest.schemaHash },
      },
    };
  }
  if (params.kind === "action") {
    const action = operation as CompiledCapabilityAction;
    if (action.manifest.idempotency === "required" && !params.context.idempotencyKey) {
      return {
        ok: false,
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "This action requires an Idempotency-Key",
          status: 400,
        },
      };
    }
  }
  const input = operation.definition.input.safeParse(params.input);
  if (!input.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Capability input is invalid",
        status: 400,
        details: { issues: input.error.issues },
      },
    };
  }
  try {
    const invoked = await operation.definition.run(input.data, params.context);
    if (!invoked.ok) return invoked;
    const validated = validateCapabilityResult(params.compiled, operation, invoked.data);
    return validated.ok
      ? ({
          ok: true,
          data: validated.data,
        } as CapabilityInvocationResult<unknown>)
      : { ok: false, error: validated.error };
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error };
    try {
      params.onUnexpectedError?.(error);
    } catch {
      // Observability must not change the public failure contract.
    }
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "Capability execution failed",
        status: 500,
      },
    };
  }
};

export const reviewCompiledCapability = async (params: {
  compiled: CompiledCapabilities;
  localId: string;
  input: unknown;
  expectedSchemaHash: string | null;
  context: CapabilityExecutionContext;
  onUnexpectedError?: (error: unknown) => void;
}): Promise<CapabilityActionReviewResult> => {
  const operation = params.compiled.actions.get(params.localId);
  if (!operation || !operation.definition.review) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Capability action review not found",
        status: 404,
      },
    };
  }
  if (params.expectedSchemaHash !== operation.manifest.schemaHash) {
    return {
      ok: false,
      error: {
        code: "SCHEMA_MISMATCH",
        message: "Capability schema changed; refresh the live catalog and retry",
        status: 409,
        details: { expected: operation.manifest.schemaHash },
      },
    };
  }
  const input = operation.definition.input.safeParse(params.input);
  if (!input.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Capability input is invalid",
        status: 400,
        details: { issues: input.error.issues },
      },
    };
  }
  try {
    const reviewed = await operation.definition.review(input.data, params.context);
    if (!reviewed.ok) return reviewed;
    const parsed = CapabilityActionReviewSchema.safeParse(reviewed.data);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "Capability review returned an invalid result",
            status: 500,
          },
        };
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error };
    try {
      params.onUnexpectedError?.(error);
    } catch {
      // Observability must not change the public failure contract.
    }
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "Capability review failed",
        status: 500,
      },
    };
  }
};
