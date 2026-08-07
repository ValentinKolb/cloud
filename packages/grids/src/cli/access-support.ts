import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { resolveAccessPrincipal } from "@valentinkolb/cloud/cli";
import type { PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { type RecordScope, RecordScopeSchema } from "../contracts";
import { resolveCustomApp } from "./custom-apps";
import { resolveDocumentTemplateFromCommand } from "./documents-support";
import { resolveFormFromCommand } from "./forms-support";
import { resolveBase, resolveBaseFromCommand, resolveTable } from "./resources";
import { requireRestArg } from "./runtime";
import { resolveView } from "./views-gql-support";
import { resolveWorkflowFromCommand } from "./workflows-support";

export const PERMISSION_LEVELS = ["none", "read", "write", "admin"] as const satisfies readonly PermissionLevel[];

export const ACCESS_RESOURCE_TYPES = ["base", "table", "view", "form", "custom-app", "document-template", "workflow"] as const;

type AccessResourceType = (typeof ACCESS_RESOURCE_TYPES)[number];

export type AccessPermission = (typeof PERMISSION_LEVELS)[number];

export type AccessResource = {
  type: AccessResourceType;
  id: string;
  label: string;
  allowed: readonly AccessPermission[];
};

export const accessResourceSupportsRecordScope = (resource: AccessResource): boolean =>
  resource.type === "base" || resource.type === "table" || resource.type === "view";

export const recordScopeFromFlags = (resource: AccessResource, flags: Record<string, unknown>): RecordScope | undefined => {
  const kind = flags.recordScope;
  const relationFieldId = flags.relationFieldId;
  if (kind === undefined && relationFieldId === undefined) return undefined;
  if (!accessResourceSupportsRecordScope(resource)) {
    throw new Error("Record scopes are only supported on base, table, and view grants.");
  }
  if (kind === undefined) throw new Error("Pass --record-scope when using --relation-field-id.");
  if (kind === "related-created-by") {
    if (resource.type === "base") {
      throw new Error("--record-scope related-created-by requires a table or view resource.");
    }
    if (typeof relationFieldId !== "string" || !relationFieldId) {
      throw new Error("--record-scope related-created-by requires --relation-field-id <uuid>.");
    }
    const parsed = RecordScopeSchema.safeParse({ kind: "related_created_by", relationFieldId });
    if (!parsed.success) throw new Error("--relation-field-id must be a UUID.");
    return parsed.data;
  }
  if (relationFieldId !== undefined) {
    throw new Error("--relation-field-id is only valid with --record-scope related-created-by.");
  }
  if (kind === "created-by") return { kind: "created_by" };
  if (kind === "all") return { kind: "all" };
  throw new Error("--record-scope must be one of: all, created-by, related-created-by.");
};

export const accessPermissionsForResource = (type: AccessResourceType): readonly AccessPermission[] => {
  switch (type) {
    case "base":
      return ["read", "write", "admin", "none"];
    case "table":
      return ["read", "write", "none"];
    case "view":
      return ["read", "admin", "none"];
    case "form":
      return ["write", "none"];
    case "custom-app":
      return ["read", "none"];
    case "document-template":
    case "workflow":
      return ["read", "write", "admin", "none"];
  }
};

export const assertAccessPermission = (resource: AccessResource, permission: AccessPermission) => {
  if (!resource.allowed.includes(permission)) {
    throw new Error(`${resource.type} grants only accept: ${resource.allowed.join(", ")}.`);
  }
};

const accessApiResourceType = (type: AccessResourceType): string => (type === "document-template" ? "document-template" : type);

export const resolveAccessResource = async (ctx: CloudCliContext, args: string[]): Promise<AccessResource> => {
  const type = requireRestArg(args, 0, "resource type") as AccessResourceType;
  if (!(ACCESS_RESOURCE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Resource type must be one of: ${ACCESS_RESOURCE_TYPES.join(", ")}.`);
  }
  const rest = args.slice(1);
  if (type === "base") {
    const base = await resolveBase(ctx, requireRestArg(rest, 0, "base"));
    return { type, id: base.id, label: `${base.name} (${base.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "table") {
    const { base, rest: tableRest } = await resolveBaseFromCommand(ctx, rest, 1);
    const table = await resolveTable(ctx, base.id, requireRestArg(tableRest, 0, "table"));
    return { type, id: table.id, label: `${table.name} (${table.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "view") {
    const { base, rest: viewRest } = await resolveBaseFromCommand(ctx, rest, 2);
    const table = await resolveTable(ctx, base.id, requireRestArg(viewRest, 0, "table"));
    const view = await resolveView(ctx, table.id, requireRestArg(viewRest, 1, "view"));
    return { type, id: view.id, label: `${view.name} (${view.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "form") {
    const { form } = await resolveFormFromCommand(ctx, rest, {});
    return { type, id: form.id, label: `${form.name} (${form.shortId || "default"})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "custom-app") {
    const { base, rest: appRest } = await resolveBaseFromCommand(ctx, rest, 1);
    const app = await resolveCustomApp(ctx, base.id, requireRestArg(appRest, 0, "Custom App"));
    return { type, id: app.id, label: `${app.name} (${app.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  if (type === "document-template") {
    const { template } = await resolveDocumentTemplateFromCommand(ctx, rest, {});
    return { type, id: template.id, label: `${template.name} (${template.shortId})`, allowed: accessPermissionsForResource(type) };
  }
  const { workflow } = await resolveWorkflowFromCommand(ctx, rest, undefined);
  return { type, id: workflow.id, label: `${workflow.name} (${workflow.shortId})`, allowed: accessPermissionsForResource(type) };
};

export const accessResourcePath = (resource: AccessResource): string =>
  `/access/by-${accessApiResourceType(resource.type)}/${encodeURIComponent(resource.id)}`;

export const principalKey = (principal: Principal): string => {
  switch (principal.type) {
    case "user":
      return `user:${principal.userId}`;
    case "group":
      return `group:${principal.groupId}`;
    case "service_account":
      return `service_account:${principal.serviceAccountId}`;
    case "authenticated":
      return "authenticated";
    case "public":
      return "public";
  }
};

export const resolvePrincipalForAccess = (ctx: CloudCliContext, flags: Record<string, unknown>): Promise<Principal> =>
  resolveAccessPrincipal(ctx, flags, { allowPublic: true, allowServiceAccounts: true });
