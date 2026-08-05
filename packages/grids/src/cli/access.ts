import { arg, command, confirmFlag, flag, listAccessPrincipalEntities, paginationFlags, printStructured } from "@valentinkolb/cloud/cli";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { RecordScope } from "../contracts";
import {
  ACCESS_RESOURCE_TYPES,
  type AccessPermission,
  accessPermissionsForResource,
  accessResourcePath,
  accessResourceSupportsRecordScope,
  assertAccessPermission,
  PERMISSION_LEVELS,
  principalKey,
  recordScopeFromFlags,
  resolveAccessResource,
  resolvePrincipalForAccess,
} from "./access-support";
import { jsonRequest, type MessageResponse, printJsonOrMessage, printReference, readApi } from "./runtime";

type GridsAccessEntry = AccessEntry & { recordScope?: RecordScope };

const recordScopeFlags = {
  recordScope: flag.enum(["all", "created-by", "related-created-by"] as const, {
    name: "record-scope",
    description: "Visible records for this grant; base, table, and view only",
  }),
  relationFieldId: flag.string({
    name: "relation-field-id",
    description: "Relation field UUID for --record-scope related-created-by",
  }),
};

const scopeLabel = (scope: RecordScope | undefined): string => {
  if (!scope || scope.kind === "all") return "all";
  if (scope.kind === "created_by") return "created-by";
  return `related-created-by:${scope.relationFieldId}`;
};

const principalLabel = (entry: AccessEntry): string => {
  if (entry.displayName) return entry.displayName;
  if (entry.principal.type === "user") return entry.principal.userId;
  if (entry.principal.type === "group") return entry.principal.groupId;
  if (entry.principal.type === "service_account") return entry.principal.serviceAccountId;
  return entry.principal.type === "authenticated" ? "All users (incl. guests)" : "Public";
};

const printGridsAccessEntries = (
  ctx: Parameters<typeof printStructured>[0],
  resource: Awaited<ReturnType<typeof resolveAccessResource>>,
  entries: GridsAccessEntry[],
  includeServiceAccounts: boolean,
) => {
  if (printStructured(ctx, { resource, entries })) return;
  const rows = entries
    .filter((entry) => includeServiceAccounts || entry.principal.type !== "service_account")
    .map((entry) => ({
      principal: principalLabel(entry),
      type: entry.principal.type,
      permission: entry.permission,
      recordScope: accessResourceSupportsRecordScope(resource) ? scopeLabel(entry.recordScope) : "—",
      accessId: entry.id,
    }));
  if (rows.length === 0) {
    ctx.print("No direct grants.");
    return;
  }
  ctx.table(rows, [
    { key: "principal", label: "PRINCIPAL" },
    { key: "type", label: "TYPE" },
    { key: "permission", label: "PERMISSION" },
    { key: "recordScope", label: "RECORD SCOPE" },
    { key: "accessId", label: "ACCESS ID" },
  ]);
};

export const accessCommands = [
  command("access reference", {
    summary: "Show Grids resource access levels",
    description: "Direct grants are resource-specific. Inherited effective access is resolved by the backend at use time.",
    examples: ["cld grids access reference", "cld grids access reference --json"],
    async run({ ctx }) {
      const reference = {
        resourceTypes: ACCESS_RESOURCE_TYPES.map((type) => ({ type, permissions: accessPermissionsForResource(type) })),
        principalFlags: [
          "--user <id|uid|email|display name>",
          "--group <id|name>",
          "--service-account <id|name>",
          "--authenticated",
          "--public",
        ],
        examples: [
          "cld grids access list table Bookshop Authors",
          "cld grids access grant table Requests Requests --authenticated --permission read --record-scope created-by",
          "cld grids access grant table Requests Comments --authenticated --permission read --record-scope related-created-by --relation-field-id <uuid>",
          "cld grids access set document-template Bookshop Invoices Invoice --user ada@example.test --permission write",
          "cld grids access revoke workflow Bookshop 'Send reminder' --user ada@example.test --yes",
        ],
      };
      printReference(
        ctx,
        reference,
        [
          "Grids access",
          "",
          "Direct grants attach to one Grids resource. The backend still enforces inherited and effective access when a command runs.",
          "Base, table, and view grants also accept --record-scope all|created-by|related-created-by.",
          "Related creator scopes additionally require --relation-field-id <uuid> and follow one same-base relation.",
          "",
          "Resources:",
          ...reference.resourceTypes.map((item) => `  ${item.type}: ${item.permissions.join(", ")}`),
          "",
          "Principals:",
          ...reference.principalFlags.map((item) => `  ${item}`),
          "",
          "Examples:",
          ...reference.examples.map((item) => `  ${item}`),
        ].join("\n"),
      );
    },
  }),
  command("access list", {
    summary: "List direct grants for a Grids resource",
    args: {
      args: arg.rest({
        valueLabel: "resource-type refs",
        description: "Resource type followed by refs, e.g. table Bookshop Authors or document-template Bookshop Invoices Invoice.",
      }),
    },
    flags: {
      includeServiceAccounts: flag.boolean({
        name: "include-service-accounts",
        description: "Include service-account grants in text output.",
      }),
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const entries = await readApi<GridsAccessEntry[]>(ctx, accessResourcePath(resource));
      printGridsAccessEntries(ctx, resource, entries, flags.includeServiceAccounts);
    },
  }),
  command("access grant", {
    summary: "Create a direct Grids resource grant",
    args: {
      args: arg.rest({ valueLabel: "resource-type refs", description: "Resource type followed by resource refs." }),
    },
    flags: {
      user: flag.string({ description: "User id, uid, email, or exact display name" }),
      group: flag.string({ description: "Group id or exact name" }),
      serviceAccount: flag.string({ name: "service-account", description: "Service account id or exact name" }),
      authenticated: flag.boolean({ description: "Signed-in users" }),
      public: flag.boolean({ description: "Anyone with the link, including anonymous users" }),
      permission: flag.enum(PERMISSION_LEVELS, { required: true, description: "Permission to grant" }),
      ...recordScopeFlags,
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const permission = flags.permission as AccessPermission;
      assertAccessPermission(resource, permission);
      const principal = await resolvePrincipalForAccess(ctx, flags);
      const recordScope = recordScopeFromFlags(resource, flags);
      const created = await readApi<{ accessId: string }>(
        ctx,
        accessResourcePath(resource),
        jsonRequest("POST", { principal, permission, ...(recordScope ? { recordScope } : {}) }),
      );
      printJsonOrMessage(
        ctx,
        {
          resource,
          principal,
          permission,
          ...(accessResourceSupportsRecordScope(resource) ? { recordScope: recordScope ?? { kind: "all" as const } } : {}),
          ...created,
        },
        `Granted ${permission} on ${resource.label}${
          accessResourceSupportsRecordScope(resource) ? ` with record scope ${scopeLabel(recordScope)}` : ""
        }.`,
      );
    },
  }),
  command("access set", {
    summary: "Create or update a direct Grids resource grant",
    description:
      "With --access-id this patches that grant. Otherwise the CLI resolves the principal and updates or creates its direct grant.",
    args: {
      args: arg.rest({ valueLabel: "resource-type refs", description: "Resource type followed by resource refs." }),
    },
    flags: {
      user: flag.string({ description: "User id, uid, email, or exact display name" }),
      group: flag.string({ description: "Group id or exact name" }),
      serviceAccount: flag.string({ name: "service-account", description: "Service account id or exact name" }),
      authenticated: flag.boolean({ description: "Signed-in users" }),
      public: flag.boolean({ description: "Anyone with the link, including anonymous users" }),
      accessId: flag.string({ name: "access-id", description: "Direct access entry id from access list" }),
      permission: flag.enum(PERMISSION_LEVELS, { required: true, description: "Permission to set" }),
      ...recordScopeFlags,
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const permission = flags.permission as AccessPermission;
      assertAccessPermission(resource, permission);
      const recordScope = recordScopeFromFlags(resource, flags);
      if (flags.accessId) {
        await readApi<MessageResponse>(
          ctx,
          `/access/${encodeURIComponent(flags.accessId)}`,
          jsonRequest("PATCH", { permission, ...(recordScope ? { recordScope } : {}) }),
        );
        printJsonOrMessage(
          ctx,
          { resource, accessId: flags.accessId, permission, ...(recordScope ? { recordScope } : {}), action: "updated" },
          `Updated ${flags.accessId} to ${permission}${recordScope ? ` with record scope ${scopeLabel(recordScope)}` : ""}.`,
        );
        return;
      }
      const principal = await resolvePrincipalForAccess(ctx, flags);
      const entries = await readApi<GridsAccessEntry[]>(ctx, accessResourcePath(resource));
      const existing = entries.find((entry) => principalKey(entry.principal) === principalKey(principal));
      if (existing) {
        await readApi<MessageResponse>(
          ctx,
          `/access/${encodeURIComponent(existing.id)}`,
          jsonRequest("PATCH", { permission, ...(recordScope ? { recordScope } : {}) }),
        );
        printJsonOrMessage(
          ctx,
          { resource, accessId: existing.id, permission, ...(recordScope ? { recordScope } : {}), action: "updated" },
          `Updated ${existing.id} to ${permission}${recordScope ? ` with record scope ${scopeLabel(recordScope)}` : ""}.`,
        );
        return;
      }
      const created = await readApi<{ accessId: string }>(
        ctx,
        accessResourcePath(resource),
        jsonRequest("POST", { principal, permission, ...(recordScope ? { recordScope } : {}) }),
      );
      printJsonOrMessage(
        ctx,
        {
          resource,
          principal,
          permission,
          ...(accessResourceSupportsRecordScope(resource) ? { recordScope: recordScope ?? { kind: "all" as const } } : {}),
          ...created,
          action: "created",
        },
        `Granted ${permission} on ${resource.label}${
          accessResourceSupportsRecordScope(resource) ? ` with record scope ${scopeLabel(recordScope)}` : ""
        }.`,
      );
    },
  }),
  command("access revoke", {
    summary: "Revoke a direct Grids resource grant",
    args: {
      args: arg.rest({ valueLabel: "resource-type refs", description: "Resource type followed by resource refs." }),
    },
    flags: {
      user: flag.string({ description: "User id, uid, email, or exact display name" }),
      group: flag.string({ description: "Group id or exact name" }),
      serviceAccount: flag.string({ name: "service-account", description: "Service account id or exact name" }),
      authenticated: flag.boolean({ description: "Signed-in users" }),
      public: flag.boolean({ description: "Anyone with the link, including anonymous users" }),
      accessId: flag.string({ name: "access-id", description: "Direct access entry id from access list" }),
      yes: confirmFlag("Confirm access revocation"),
    },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to revoke access.");
      const resource = await resolveAccessResource(ctx, args.args);
      let accessId = flags.accessId;
      if (!accessId) {
        const principal = await resolvePrincipalForAccess(ctx, flags);
        const entries = await readApi<AccessEntry[]>(ctx, accessResourcePath(resource));
        const existing = entries.find((entry) => principalKey(entry.principal) === principalKey(principal));
        if (!existing) throw new Error("No direct grant for that principal.");
        accessId = existing.id;
      }
      await readApi<MessageResponse>(ctx, `/access/${encodeURIComponent(accessId)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { resource, accessId, action: "revoked" }, `Revoked ${accessId} on ${resource.label}.`);
    },
  }),
  command("access search-principals", {
    summary: "Search users, groups, and service accounts for grants",
    args: { query: arg.required({ description: "Search text; exact names are safest for grant/set commands." }) },
    flags: {
      kind: flag.stringList({
        separator: ",",
        default: ["user", "group", "service_account"],
        description: "Comma-separated kinds: user, group, service_account",
      }),
      ...paginationFlags({ defaultPerPage: 20, maxPerPage: 100 }),
    },
    async run({ ctx, args, flags }) {
      const allowed = new Set(["user", "group", "service_account"]);
      const kinds = flags.kind.filter((kind): kind is "user" | "group" | "service_account" => allowed.has(kind));
      if (kinds.length !== flags.kind.length) throw new Error("--kind must contain only: user, group, service_account.");
      const payload = await listAccessPrincipalEntities(ctx, {
        search: args.query,
        kinds,
        page: flags.page,
        perPage: flags.perPage,
      });
      if (printStructured(ctx, payload)) return;
      ctx.table(
        payload.items.map((item) => {
          if (item.kind === "user") {
            return { kind: "user", name: item.user.displayName, handle: item.user.uid, detail: item.user.mail ?? "", id: item.user.id };
          }
          if (item.kind === "group") {
            return {
              kind: "group",
              name: item.group.name,
              handle: item.group.provider,
              detail: item.group.description ?? "",
              id: item.group.id,
            };
          }
          return {
            kind: "service_account",
            name: item.serviceAccount.name,
            handle: item.serviceAccount.kind,
            detail: item.serviceAccount.appId ?? "",
            id: item.serviceAccount.id,
          };
        }),
        [
          { key: "kind", label: "KIND" },
          { key: "name", label: "NAME" },
          { key: "handle", label: "HANDLE" },
          { key: "id", label: "ID" },
        ],
      );
    },
  }),
];
