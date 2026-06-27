import { readFile } from "node:fs/promises";
import { type CloudCliContext, type CloudCliFlags, defineCloudCliModule } from "./index";

type User = {
  id: string;
  uid: string;
  provider: "ipa" | "local";
  profile: "user" | "guest";
  roles: string[];
  givenname: string;
  sn: string;
  displayName: string;
  mail: string | null;
  memberofGroup: string[];
  manages: string[];
  accountExpires: string | null;
  lastLoginLocal: string | null;
  ipa: null | {
    phone: string | null;
    address: {
      street: string | null;
      postalCode: string | null;
      city: string | null;
      state: string | null;
    };
    passwordExpires: string | null;
    lastLoginIpa: string | null;
    sshPublicKeys: string[];
    sshFingerprints: string[];
  };
};

type ApiKey = {
  id: string;
  name: string;
  status: "active" | "revoked";
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type AccountActivity = {
  id: number;
  createdAt: string;
  action: string;
  label: string;
  outcome: "allowed" | "denied" | "failed";
};

const help = () => `cld account

Usage:
  cld account whoami
  cld account profile show
  cld account profile set [profile/address flags]
  cld account activity [--days 7|30|90]

  cld account api-keys list
  cld account api-keys create <name> [--expires <ISO|7d|30d|90d|1y>]
  cld account api-keys revoke <id|prefix|name> [--yes]

  cld account ssh-keys list
  cld account ssh-keys add <public-key>|--file <path>
  cld account ssh-keys remove <fingerprint|key-prefix>

  cld account password change --current-password-file <path> --new-password-file <path>
  cld account password change --current-password=<value> --new-password=<value>
  cld account extend

Profile flags:
  --given-name <text> --last-name <text> --display-name <text>
  --phone <text> --street <text> --postal-code <text> --city <text> --state <text>

Notes:
  This module manages the authenticated account through /api/me.
  API key tokens are shown once by the server. Store them deliberately.
  Prefer password files over password flags so secrets do not land in shell history.
`;

const stringFlag = (flags: CloudCliFlags, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.at(-1);
  }
  return undefined;
};

const booleanFlag = (flags: CloudCliFlags, ...names: string[]): boolean => names.some((name) => flags[name] === true);

const requireArg = (args: string[], index: number, label: string): string => {
  const value = args[index];
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

const apiPath = (path = "") => `/api/me${path === "/" ? "" : path}`;

const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));

const jsonRequest = (method: string, value?: unknown): RequestInit => ({
  method,
  headers: value === undefined ? undefined : { "Content-Type": "application/json" },
  body: value === undefined ? undefined : JSON.stringify(value),
});

const printJsonOrTable = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: Parameters<CloudCliContext["table"]>[1],
) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.table(rows, columns);
};

const readSecret = async (ctx: CloudCliContext, valueFlag: string, fileFlag: string, label: string): Promise<string> => {
  const literal = stringFlag(ctx.flags, valueFlag);
  const file = stringFlag(ctx.flags, fileFlag);
  if (literal !== undefined && file !== undefined) throw new Error(`Pass only one of --${valueFlag} or --${fileFlag}.`);
  if (literal !== undefined) return literal;
  if (file) return (await readFile(file, "utf8")).replace(/\r?\n$/, "");
  throw new Error(`Missing ${label}. Pass --${valueFlag} or --${fileFlag}.`);
};

const parseExpiry = (value: string | undefined): string | null => {
  if (!value) return null;
  const relative = value.match(/^(\d+)([dwmqy])$/i);
  if (relative) {
    const amount = Number.parseInt(relative[1]!, 10);
    const unit = relative[2]!.toLowerCase();
    const days = unit === "d" ? amount : unit === "w" ? amount * 7 : unit === "m" ? amount * 30 : unit === "q" ? amount * 90 : amount * 365;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('--expires must be an ISO timestamp or a duration like "90d".');
  return date.toISOString();
};

const userRows = (user: User) => [
  { key: "uid", value: user.uid },
  { key: "name", value: user.displayName },
  { key: "mail", value: user.mail ?? "" },
  { key: "provider", value: user.provider },
  { key: "profile", value: user.profile },
  { key: "roles", value: user.roles.join(", ") },
];

const profileRows = (user: User) => [
  ...userRows(user),
  { key: "given name", value: user.givenname },
  { key: "last name", value: user.sn },
  { key: "phone", value: user.ipa?.phone ?? "" },
  { key: "street", value: user.ipa?.address.street ?? "" },
  { key: "postal code", value: user.ipa?.address.postalCode ?? "" },
  { key: "city", value: user.ipa?.address.city ?? "" },
  { key: "state", value: user.ipa?.address.state ?? "" },
  { key: "groups", value: user.memberofGroup.join(", ") },
  { key: "manages", value: user.manages.join(", ") },
];

const apiKeyRows = (keys: ApiKey[]) =>
  keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.tokenPrefix,
    expires: key.expiresAt ?? "never",
    lastUsed: key.lastUsedAt ?? "never",
    created: key.createdAt,
  }));

const activityRows = (items: AccountActivity[]) =>
  items.map((item) => ({
    id: item.id,
    time: item.createdAt,
    outcome: item.outcome,
    action: item.action,
    label: item.label,
  }));

const buildProfileUpdate = (ctx: CloudCliContext) => {
  const data: {
    givenname?: string;
    sn?: string;
    displayName?: string;
    ipa?: {
      phone?: string;
      address?: {
        street?: string;
        postalCode?: string;
        city?: string;
        state?: string;
      };
      sshPublicKeys?: string[];
    };
  } = {};

  const givenname = stringFlag(ctx.flags, "given-name", "givenname");
  const sn = stringFlag(ctx.flags, "last-name", "sn");
  const displayName = stringFlag(ctx.flags, "display-name", "displayName");
  if (givenname !== undefined) data.givenname = givenname;
  if (sn !== undefined) data.sn = sn;
  if (displayName !== undefined) data.displayName = displayName;

  const phone = stringFlag(ctx.flags, "phone");
  const street = stringFlag(ctx.flags, "street");
  const postalCode = stringFlag(ctx.flags, "postal-code", "postalCode");
  const city = stringFlag(ctx.flags, "city");
  const state = stringFlag(ctx.flags, "state");
  if ([phone, street, postalCode, city, state].some((value) => value !== undefined)) {
    data.ipa = {};
    if (phone !== undefined) data.ipa.phone = phone;
    if ([street, postalCode, city, state].some((value) => value !== undefined)) {
      data.ipa.address = {};
      if (street !== undefined) data.ipa.address.street = street;
      if (postalCode !== undefined) data.ipa.address.postalCode = postalCode;
      if (city !== undefined) data.ipa.address.city = city;
      if (state !== undefined) data.ipa.address.state = state;
    }
  }

  if (Object.keys(data).length === 0) throw new Error("No profile fields provided.");
  return data;
};

const getCurrentUser = (ctx: CloudCliContext): Promise<User> => readApi<User>(ctx, "/");

const updateProfile = async (ctx: CloudCliContext, data: unknown) => {
  const result = await readApi<{ message: string }>(ctx, "/", jsonRequest("PATCH", data));
  if (ctx.options.output === "json") ctx.json(result);
  else ctx.print(result.message);
};

const resolveApiKey = async (ctx: CloudCliContext, ref: string): Promise<ApiKey> => {
  const { items } = await readApi<{ items: ApiKey[] }>(ctx, "/api-keys");
  const matches = items.filter((key) => key.id === ref || key.tokenPrefix === ref || key.tokenPrefix.startsWith(ref) || key.name === ref);
  if (matches.length === 0) throw new Error(`API key not found: ${ref}`);
  if (matches.length > 1) throw new Error(`API key reference is ambiguous: ${ref}`);
  return matches[0]!;
};

const requireIpaUser = (user: User): NonNullable<User["ipa"]> => {
  if (!user.ipa) throw new Error("SSH keys and address fields are only available for IPA-backed accounts.");
  return user.ipa;
};

const readPublicKey = async (ctx: CloudCliContext, args: string[]): Promise<string> => {
  const file = stringFlag(ctx.flags, "file", "f");
  if (file && args.length > 0) throw new Error("Pass either a public key argument or --file, not both.");
  const key = file ? await readFile(file, "utf8") : args.join(" ");
  const trimmed = key.trim();
  if (!trimmed) throw new Error("Missing SSH public key.");
  return trimmed;
};

const removeSshKey = (user: User, ref: string): string[] => {
  const ipa = requireIpaUser(user);
  const matches = ipa.sshPublicKeys
    .map((key, index) => ({ index, key, fingerprint: ipa.sshFingerprints[index] ?? "" }))
    .filter((item) => item.key === ref || item.key.startsWith(ref) || item.fingerprint.startsWith(ref));
  if (matches.length === 0) throw new Error(`SSH key not found: ${ref}`);
  if (matches.length > 1) {
    const candidates = matches.map((item) => `${item.fingerprint || "no fingerprint"} ${item.key.slice(0, 48)}`).join(", ");
    throw new Error(`SSH key reference is ambiguous: ${ref}. Candidates: ${candidates}`);
  }
  const index = matches[0]!.index;
  return ipa.sshPublicKeys.filter((_, keyIndex) => keyIndex !== index);
};

export default defineCloudCliModule({
  name: "account",
  summary: "Manage the authenticated account, profile, personal API keys, and SSH keys.",
  booleanFlags: ["yes"],
  help,
  async run(ctx) {
    const command = requireArg(ctx.args, 0, "command");
    const args = ctx.args.slice(1);

    if (command === "whoami") {
      const user = await getCurrentUser(ctx);
      printJsonOrTable(ctx, user, userRows(user), [{ key: "key" }, { key: "value" }]);
      return;
    }

    if (command === "profile") {
      const sub = requireArg(args, 0, "profile command");
      if (sub === "show") {
        const user = await getCurrentUser(ctx);
        printJsonOrTable(ctx, user, profileRows(user), [{ key: "key" }, { key: "value" }]);
        return;
      }
      if (sub === "set") {
        await updateProfile(ctx, buildProfileUpdate(ctx));
        return;
      }
      throw new Error(`Unknown profile command "${sub}".`);
    }

    if (command === "activity") {
      const days = stringFlag(ctx.flags, "days") ?? "30";
      const result = await readApi<{ items: AccountActivity[] }>(ctx, `/activity?days=${encodeURIComponent(days)}`);
      printJsonOrTable(ctx, result, activityRows(result.items), [{ key: "time" }, { key: "outcome" }, { key: "action" }, { key: "label" }]);
      return;
    }

    if (command === "api-keys") {
      const sub = requireArg(args, 0, "api-keys command");
      if (sub === "list") {
        const result = await readApi<{ items: ApiKey[] }>(ctx, "/api-keys");
        printJsonOrTable(ctx, result, apiKeyRows(result.items), [
          { key: "name" },
          { key: "prefix" },
          { key: "expires" },
          { key: "lastUsed" },
          { key: "id" },
        ]);
        return;
      }
      if (sub === "create") {
        const name = requireArg(args, 1, "API key name");
        const result = await readApi<{ credential: ApiKey; token: string }>(
          ctx,
          "/api-keys",
          jsonRequest("POST", { name, expiresAt: parseExpiry(stringFlag(ctx.flags, "expires")) }),
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Token: ${result.token}\nPrefix: ${result.credential.tokenPrefix}\nStore this token now. It cannot be shown again.`);
        return;
      }
      if (sub === "revoke") {
        const ref = requireArg(args, 1, "API key reference");
        if (!booleanFlag(ctx.flags, "yes")) throw new Error("Refusing to revoke without --yes.");
        const key = await resolveApiKey(ctx, ref);
        const result = await readApi<{ message: string }>(ctx, `/api-keys/${encodeURIComponent(key.id)}`, jsonRequest("DELETE"));
        if (ctx.options.output === "json") ctx.json({ ...result, credential: key });
        else ctx.print(result.message);
        return;
      }
      throw new Error(`Unknown api-keys command "${sub}".`);
    }

    if (command === "ssh-keys") {
      const sub = requireArg(args, 0, "ssh-keys command");
      const user = await getCurrentUser(ctx);
      const ipa = requireIpaUser(user);
      if (sub === "list") {
        const items = ipa.sshPublicKeys.map((key, index) => ({ fingerprint: ipa.sshFingerprints[index] ?? "", key }));
        printJsonOrTable(ctx, { items }, items, [{ key: "fingerprint" }, { key: "key" }]);
        return;
      }
      if (sub === "add") {
        const key = await readPublicKey(ctx, args.slice(1));
        if (ipa.sshPublicKeys.includes(key)) throw new Error("SSH public key already exists.");
        await updateProfile(ctx, { ipa: { sshPublicKeys: [...ipa.sshPublicKeys, key] } });
        return;
      }
      if (sub === "remove") {
        const ref = requireArg(args, 1, "SSH key reference");
        await updateProfile(ctx, { ipa: { sshPublicKeys: removeSshKey(user, ref) } });
        return;
      }
      throw new Error(`Unknown ssh-keys command "${sub}".`);
    }

    if (command === "password") {
      const sub = requireArg(args, 0, "password command");
      if (sub !== "change") throw new Error(`Unknown password command "${sub}".`);
      const currentPassword = await readSecret(ctx, "current-password", "current-password-file", "current password");
      const newPassword = await readSecret(ctx, "new-password", "new-password-file", "new password");
      const result = await readApi<{ message: string }>(
        ctx,
        "/password",
        jsonRequest("POST", { currentPassword, newPassword, confirmPassword: newPassword }),
      );
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(result.message);
      return;
    }

    if (command === "extend") {
      const result = await readApi<{ message: string; newExpiry?: string }>(ctx, "/account-extension", jsonRequest("POST"));
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(result.newExpiry ? `${result.message} New expiry: ${result.newExpiry}` : result.message);
      return;
    }

    throw new Error(`Unknown account command "${command}".`);
  },
});
