import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { resolveAccessPrincipal } from "@valentinkolb/cloud/cli";
import type { PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { resolveDocumentTemplateFromCommand } from "./documents-support";
import { resolveDashboardFromCommand, resolveFormFromCommand } from "./forms-dashboards-support";
import { resolveBase, resolveBaseFromCommand, resolveTable } from "./resources";
import { requireRestArg } from "./runtime";
import { resolveView } from "./views-gql-support";
import { resolveWorkflowFromCommand } from "./workflows-support";

export const PERMISSION_LEVELS = ["none", "read", "write", "admin"] as const satisfies readonly PermissionLevel[];

export const ACCESS_RESOURCE_TYPES = ["base", "table", "view", "form", "dashboard", "document-template", "workflow"] as const;

type AccessResourceType = (typeof ACCESS_RESOURCE_TYPES)[number];

export type AccessPermission = (typeof PERMISSION_LEVELS)[number];

type AccessResource = {
  type: AccessResourceType;
  id: string;
  label: string;
  allowed: readonly AccessPermission[];
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
    case "dashboard":
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
  if (type === "dashboard") {
    const { dashboard } = await resolveDashboardFromCommand(ctx, rest, undefined);
    return { type, id: dashboard.id, label: `${dashboard.name} (${dashboard.shortId})`, allowed: accessPermissionsForResource(type) };
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
