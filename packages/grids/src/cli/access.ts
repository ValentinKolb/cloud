import { arg, command, confirmFlag, flag, listAccessPrincipalEntities, paginationFlags, printAccessEntries } from "@valentinkolb/cloud/cli";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  ACCESS_RESOURCE_TYPES,
  type AccessPermission,
  accessPermissionsForResource,
  accessResourcePath,
  assertAccessPermission,
  PERMISSION_LEVELS,
  principalKey,
  resolveAccessResource,
  resolvePrincipalForAccess,
} from "./access-support";
import { jsonRequest, type MessageResponse, printJsonOrMessage, printReference, readApi } from "./runtime";

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
      const entries = await readApi<AccessEntry[]>(ctx, accessResourcePath(resource));
      printAccessEntries(ctx, entries, {
        includeServiceAccounts: flags.includeServiceAccounts,
        jsonValue: { resource, entries },
      });
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
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const permission = flags.permission as AccessPermission;
      assertAccessPermission(resource, permission);
      const principal = await resolvePrincipalForAccess(ctx, flags);
      const created = await readApi<{ accessId: string }>(
        ctx,
        accessResourcePath(resource),
        jsonRequest("POST", { principal, permission }),
      );
      printJsonOrMessage(ctx, { resource, principal, permission, ...created }, `Granted ${permission} on ${resource.label}.`);
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
    },
    async run({ ctx, args, flags }) {
      const resource = await resolveAccessResource(ctx, args.args);
      const permission = flags.permission as AccessPermission;
      assertAccessPermission(resource, permission);
      if (flags.accessId) {
        await readApi<MessageResponse>(ctx, `/access/${encodeURIComponent(flags.accessId)}`, jsonRequest("PATCH", { permission }));
        printJsonOrMessage(
          ctx,
          { resource, accessId: flags.accessId, permission, action: "updated" },
          `Updated ${flags.accessId} to ${permission}.`,
        );
        return;
      }
      const principal = await resolvePrincipalForAccess(ctx, flags);
      const entries = await readApi<AccessEntry[]>(ctx, accessResourcePath(resource));
      const existing = entries.find((entry) => principalKey(entry.principal) === principalKey(principal));
      if (existing) {
        await readApi<MessageResponse>(ctx, `/access/${encodeURIComponent(existing.id)}`, jsonRequest("PATCH", { permission }));
        printJsonOrMessage(
          ctx,
          { resource, accessId: existing.id, permission, action: "updated" },
          `Updated ${existing.id} to ${permission}.`,
        );
        return;
      }
      const created = await readApi<{ accessId: string }>(
        ctx,
        accessResourcePath(resource),
        jsonRequest("POST", { principal, permission }),
      );
      printJsonOrMessage(
        ctx,
        { resource, principal, permission, ...created, action: "created" },
        `Granted ${permission} on ${resource.label}.`,
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
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return;
      }
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
