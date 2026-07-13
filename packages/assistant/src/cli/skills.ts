import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  arg,
  command,
  confirmFlag,
  flag,
  readCliInput,
  resolveAccessPrincipal,
  type CloudCliContext,
} from "@valentinkolb/cloud/cli";
import {
  AI_SKILL_FILE_MAX_BYTES,
  AI_SKILL_SLUG_RE,
  AI_SKILL_TOTAL_MAX_BYTES,
  type AiSkill,
  type AiSkillEvent,
  type AiSkillUserView,
  guessAiMediaType,
} from "@valentinkolb/cloud/ai";
import { jsonRequest, printRows, printValue, readSkillsApi, requireConfirmation } from "./shared";

type SkillTreeWireFile = {
  path: string;
  size: number;
  mediaType: string;
  updatedAt: string;
  encoding: "base64";
  content: string;
};

type SkillTreeWire = { skill: AiSkill; contentHash: string; files: SkillTreeWireFile[] };
type LocalSkillFile = { path: string; localPath: string; bytes: Uint8Array; mediaType: string };
type AccessEntry = {
  id: string;
  principal: { type: string; userId?: string; groupId?: string };
  permission: string;
  displayName?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const skillPath = (skillId: string, suffix = ""): string => `/${encodeURIComponent(skillId)}${suffix}`;

const listSkills = (ctx: CloudCliContext, managed = false): Promise<{ skills: AiSkillUserView[] }> =>
  readSkillsApi(ctx, managed ? "/managed" : "/");

const resolveSkill = async (ctx: CloudCliContext, reference: string, managed = false): Promise<AiSkillUserView | AiSkill> => {
  if (UUID_RE.test(reference)) {
    const detail = await readSkillsApi<{ skill: AiSkillUserView | AiSkill }>(ctx, skillPath(reference));
    return detail.skill;
  }
  const { skills } = await listSkills(ctx, managed);
  const matches = skills.filter((skill) => skill.slug === reference);
  if (matches.length === 1) return matches[0]!;
  throw new Error(`Unknown skill "${reference}". Use an exact slug or ID.`);
};

const slashPath = (value: string): string => value.split(sep).join("/");

const walkLocalSkill = async (rootInput: string): Promise<LocalSkillFile[]> => {
  const root = resolve(rootInput);
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`Skill directory not found: ${rootInput}`);
  const files: LocalSkillFile[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const localPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill trees cannot contain symlinks: ${localPath}`);
      if (entry.isDirectory()) {
        await visit(localPath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported skill tree entry: ${localPath}`);
      const bytes = new Uint8Array(await readFile(localPath));
      const path = `/${slashPath(relative(root, localPath))}`;
      if (bytes.byteLength > AI_SKILL_FILE_MAX_BYTES) throw new Error(`${path} exceeds the 2 MB skill file limit.`);
      files.push({ path, localPath, bytes, mediaType: guessAiMediaType(path) });
    }
  };
  await visit(root);
  if (!files.some((file) => file.path === "/SKILL.md")) throw new Error("Skill directory must contain SKILL.md at its root.");
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > AI_SKILL_TOTAL_MAX_BYTES) throw new Error("Skill directory exceeds the 20 MB total limit.");
  return files;
};

const parseSkillSlug = (skillMd: Uint8Array, directory: string, explicit?: string): string => {
  const text = new TextDecoder().decode(skillMd);
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.trimStart());
  const nameLine = frontmatter?.[1]?.split(/\r?\n/).find((line) => /^name\s*:/i.test(line.trim()));
  const name = nameLine?.slice(nameLine.indexOf(":") + 1).trim().replace(/^['"]|['"]$/g, "");
  const slug = explicit ?? name ?? basename(resolve(directory));
  if (!AI_SKILL_SLUG_RE.test(slug)) throw new Error(`Invalid skill slug "${slug}". Use lowercase letters, digits, and hyphens.`);
  return slug;
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const treePlan = (local: LocalSkillFile[], remote: SkillTreeWireFile[], prune: boolean) => {
  const localByPath = new Map(local.map((file) => [file.path, file]));
  const remoteByPath = new Map(remote.map((file) => [file.path, file]));
  const added = local.filter((file) => !remoteByPath.has(file.path)).map((file) => file.path);
  const changed = local
    .filter((file) => {
      const current = remoteByPath.get(file.path);
      return current ? !sameBytes(file.bytes, new Uint8Array(Buffer.from(current.content, "base64"))) : false;
    })
    .map((file) => file.path);
  const deleted = prune ? remote.filter((file) => !localByPath.has(file.path)).map((file) => file.path) : [];
  return { added, changed, deleted, unchanged: local.length - added.length - changed.length };
};

const assertNoSymlinkParents = async (root: string, target: string): Promise<void> => {
  const parts = relative(root, dirname(target)).split(sep).filter(Boolean);
  let current = root;
  for (const part of ["", ...parts]) {
    if (part) current = join(current, part);
    const stat = await lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${current}`);
    if (stat && !stat.isDirectory()) throw new Error(`Expected a directory: ${current}`);
  }
};

const writePulledTree = async (destination: string, files: SkillTreeWireFile[], force: boolean, dryRun: boolean) => {
  const root = resolve(destination);
  const writes: Array<{ target: string; bytes: Uint8Array; exists: boolean }> = [];
  for (const file of files) {
    const target = resolve(root, `.${file.path}`);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`Unsafe remote skill path: ${file.path}`);
    await assertNoSymlinkParents(root, target);
    const bytes = new Uint8Array(Buffer.from(file.content, "base64"));
    const stat = await lstat(target).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${target}`);
    if (stat && !stat.isFile()) throw new Error(`Refusing to replace non-file path: ${target}`);
    if (stat) {
      const current = new Uint8Array(await readFile(target));
      if (sameBytes(current, bytes)) continue;
      if (!force) throw new Error(`Local file differs: ${target}. Re-run with --force to replace it.`);
    }
    writes.push({ target, bytes, exists: Boolean(stat) });
  }
  if (dryRun) return { written: writes.map((entry) => entry.target), destination: root };

  const staged: Array<{ target: string; temporary: string }> = [];
  try {
    for (const entry of writes) {
      await mkdir(dirname(entry.target), { recursive: true });
      const temporary = `${entry.target}.cld-${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, entry.bytes, { flag: "wx" });
      staged.push({ target: entry.target, temporary });
    }
    for (const entry of staged) await rename(entry.temporary, entry.target);
  } catch (error) {
    await Promise.all(staged.map((entry) => rm(entry.temporary, { force: true }).catch(() => undefined)));
    throw error;
  }
  return { written: writes.map((entry) => entry.target), destination: root };
};

const accessLabel = (entry: AccessEntry): string =>
  entry.displayName ?? entry.principal.userId ?? entry.principal.groupId ?? entry.principal.type;

export const assistantSkillCommands = [
  command("skills list", {
    summary: "List available skills",
    flags: { managed: flag.boolean({ description: "Include disabled skills you can manage" }) },
    async run({ ctx, flags }) {
      const result = await listSkills(ctx, flags.managed);
      printRows(
        ctx,
        result,
        result.skills.map((skill) => ({
          id: skill.id,
          slug: skill.slug,
          origin: skill.origin,
          state: skill.userState,
          enabled: skill.enabled ? "yes" : "no",
          description: skill.description,
        })),
        [{ key: "id" }, { key: "slug" }, { key: "origin" }, { key: "state" }, { key: "enabled" }, { key: "description" }],
      );
    },
  }),
  command("skills get", {
    summary: "Show one skill and its file list",
    args: { skill: arg.required({ valueLabel: "skill-id-or-slug" }) },
    async run({ ctx, args }) {
      const skill = await resolveSkill(ctx, args.skill);
      printValue(ctx, await readSkillsApi(ctx, skillPath(skill.id)));
    },
  }),
  command("skills create", {
    summary: "Create a skill with a starter SKILL.md",
    args: { slug: arg.required() },
    flags: { description: flag.string(), workspace: flag.boolean({ description: "Create an admin-managed workspace skill" }) },
    async run({ ctx, args, flags }) {
      const result = await readSkillsApi<{ skill: AiSkill }>(
        ctx,
        "/",
        jsonRequest("POST", { slug: args.slug, description: flags.description, workspace: flags.workspace || undefined }),
      );
      printValue(ctx, result, `${result.skill.id}\t${result.skill.slug}`);
    },
  }),
  ...(["enable", "disable"] as const).map((action) =>
    command(`skills ${action}`, {
      summary: `${action === "enable" ? "Enable" : "Disable"} a skill for your Assistant`,
      args: { skill: arg.required({ valueLabel: "skill-id-or-slug" }) },
      async run({ ctx, args }) {
        const skill = await resolveSkill(ctx, args.skill, true);
        const result = await readSkillsApi(ctx, skillPath(skill.id, "/state"), jsonRequest("PUT", { state: `${action}d` }));
        printValue(ctx, result, `${skill.slug}: ${action}d`);
      },
    }),
  ),
  command("skills delete", {
    summary: "Delete a managed skill",
    args: { skill: arg.required({ valueLabel: "skill-id-or-slug" }) },
    flags: { yes: confirmFlag("Confirm deleting the skill") },
    async run({ ctx, args, flags }) {
      requireConfirmation(flags.yes, "Deleting a skill");
      const skill = await resolveSkill(ctx, args.skill, true);
      const result = await readSkillsApi(ctx, skillPath(skill.id), { method: "DELETE" });
      printValue(ctx, result, `Deleted ${skill.slug}.`);
    },
  }),
  command("skills files list", {
    summary: "List files in a skill",
    args: { skill: arg.required({ valueLabel: "skill-id-or-slug" }) },
    async run({ ctx, args }) {
      const skill = await resolveSkill(ctx, args.skill);
      const detail = await readSkillsApi<{ files: Array<Record<string, unknown>> }>(ctx, skillPath(skill.id));
      printRows(ctx, detail, detail.files, [{ key: "path" }, { key: "size" }, { key: "mediaType", label: "type" }, { key: "updatedAt" }]);
    },
  }),
  command("skills files read", {
    summary: "Read one skill file",
    args: { skill: arg.required(), path: arg.required() },
    async run({ ctx, args }) {
      const skill = await resolveSkill(ctx, args.skill);
      const file = await readSkillsApi<{ path: string; content: string; encoding: "utf8" | "base64"; mediaType: string }>(
        ctx,
        `${skillPath(skill.id, "/file")}?path=${encodeURIComponent(args.path)}`,
      );
      const text = file.encoding === "utf8" ? file.content : Buffer.from(file.content, "base64").toString("base64");
      printValue(ctx, file, text);
    },
  }),
  command("skills files write", {
    summary: "Write one file in a managed skill",
    args: { skill: arg.required(), path: arg.required() },
    flags: { content: flag.input({ required: true }), mediaType: flag.string({ name: "media-type" }) },
    async run({ ctx, args, flags }) {
      const skill = await resolveSkill(ctx, args.skill, true);
      const content = await readCliInput(flags.content, { label: "skill file content", required: true });
      const result = await readSkillsApi(
        ctx,
        skillPath(skill.id, "/file"),
        jsonRequest("PUT", { path: args.path, content, encoding: "utf8", mediaType: flags.mediaType }),
      );
      printValue(ctx, result, args.path);
    },
  }),
  command("skills files delete", {
    summary: "Delete one file from a managed skill",
    args: { skill: arg.required(), path: arg.required() },
    flags: { yes: confirmFlag("Confirm deleting the skill file") },
    async run({ ctx, args, flags }) {
      requireConfirmation(flags.yes, "Deleting a skill file");
      const skill = await resolveSkill(ctx, args.skill, true);
      const result = await readSkillsApi(ctx, `${skillPath(skill.id, "/file")}?path=${encodeURIComponent(args.path)}`, { method: "DELETE" });
      printValue(ctx, result, `Deleted ${args.path}.`);
    },
  }),
  command("skills events", {
    summary: "Show a managed skill's audit events",
    args: { skill: arg.required() },
    flags: { limit: flag.int({ default: 50, min: 1, max: 200 }) },
    async run({ ctx, args, flags }) {
      const skill = await resolveSkill(ctx, args.skill, true);
      const result = await readSkillsApi<{ events: AiSkillEvent[] }>(ctx, `${skillPath(skill.id, "/events")}?limit=${flags.limit}`);
      printRows(
        ctx,
        result,
        result.events.map((event) => ({ id: event.id, event: event.event, actor: event.actorDisplayName ?? "platform", at: event.createdAt, meta: event.meta })),
        [{ key: "event" }, { key: "actor" }, { key: "at" }, { key: "meta" }, { key: "id" }],
      );
    },
  }),
  command("skills access list", {
    summary: "List direct grants on a managed skill",
    args: { skill: arg.required() },
    async run({ ctx, args }) {
      const skill = await resolveSkill(ctx, args.skill, true);
      const result = await readSkillsApi<{ entries: AccessEntry[] }>(ctx, skillPath(skill.id, "/access"));
      printRows(
        ctx,
        result,
        result.entries.map((entry) => ({ id: entry.id, principal: accessLabel(entry), type: entry.principal.type, permission: entry.permission })),
        [{ key: "principal" }, { key: "type" }, { key: "permission" }, { key: "id" }],
      );
    },
  }),
  command("skills access grant", {
    summary: "Grant direct access to a managed skill",
    args: { skill: arg.required() },
    flags: {
      user: flag.string(),
      group: flag.string(),
      authenticated: flag.boolean(),
      permission: flag.enum(["read", "write", "admin"] as const, { required: true }),
    },
    async run({ ctx, args, flags }) {
      const skill = await resolveSkill(ctx, args.skill, true);
      const principal = await resolveAccessPrincipal(ctx, flags);
      const result = await readSkillsApi(
        ctx,
        skillPath(skill.id, "/access"),
        jsonRequest("POST", { principal, permission: flags.permission }),
      );
      printValue(ctx, result, `Granted ${flags.permission}.`);
    },
  }),
  command("skills access set", {
    summary: "Change one direct skill grant",
    args: { skill: arg.required(), accessId: arg.required({ valueLabel: "access-id" }) },
    flags: { permission: flag.enum(["read", "write", "admin"] as const, { required: true }) },
    async run({ ctx, args, flags }) {
      const skill = await resolveSkill(ctx, args.skill, true);
      const result = await readSkillsApi(
        ctx,
        skillPath(skill.id, `/access/${encodeURIComponent(args.accessId)}`),
        jsonRequest("PATCH", { permission: flags.permission }),
      );
      printValue(ctx, result, `Updated ${args.accessId}.`);
    },
  }),
  command("skills access revoke", {
    summary: "Revoke one direct skill grant",
    args: { skill: arg.required(), accessId: arg.required({ valueLabel: "access-id" }) },
    flags: { yes: confirmFlag("Confirm revoking the grant") },
    async run({ ctx, args, flags }) {
      requireConfirmation(flags.yes, "Revoking skill access");
      const skill = await resolveSkill(ctx, args.skill, true);
      const result = await readSkillsApi(ctx, skillPath(skill.id, `/access/${encodeURIComponent(args.accessId)}`), { method: "DELETE" });
      printValue(ctx, result, `Revoked ${args.accessId}.`);
    },
  }),
  command("skills push", {
    summary: "Create or update a Cloud skill from a local directory",
    args: { directory: arg.required({ valueLabel: "directory" }) },
    flags: {
      slug: flag.string(),
      prune: flag.boolean({ description: "Delete remote files absent locally" }),
      yes: confirmFlag("Confirm pruning remote files"),
      dryRun: flag.boolean({ name: "dry-run" }),
    },
    async run({ ctx, args, flags }) {
      if (flags.prune) requireConfirmation(flags.yes, "Pruning a remote skill tree");
      const files = await walkLocalSkill(args.directory);
      const skillMd = files.find((file) => file.path === "/SKILL.md")!;
      const slug = parseSkillSlug(skillMd.bytes, args.directory, flags.slug);
      const managed = await listSkills(ctx, true);
      let skill = managed.skills.find((candidate) => candidate.slug === slug);

      if (!skill && flags.dryRun) {
        printValue(ctx, { action: "create", slug, files: files.map((file) => file.path), prune: flags.prune });
        return;
      }
      if (!skill) {
        const created = await readSkillsApi<{ skill: AiSkill }>(ctx, "/", jsonRequest("POST", { slug }));
        skill = created.skill as AiSkillUserView;
      }
      const remote = await readSkillsApi<SkillTreeWire>(ctx, skillPath(skill.id, "/tree"));
      const plan = treePlan(files, remote.files, flags.prune);
      if (flags.dryRun) {
        printValue(ctx, { action: "update", skill: { id: skill.id, slug: skill.slug }, ...plan });
        return;
      }
      const result = await readSkillsApi<{ contentHash: string; files: Array<Record<string, unknown>> }>(
        ctx,
        skillPath(skill.id, "/tree"),
        jsonRequest("PUT", {
          expectedHash: remote.contentHash,
          prune: flags.prune,
          files: files.map((file) => ({
            path: file.path,
            mediaType: file.mediaType,
            encoding: "base64",
            content: Buffer.from(file.bytes).toString("base64"),
          })),
        }),
      );
      printValue(ctx, { skill, plan, ...result }, `${skill.slug}: ${plan.added.length} added, ${plan.changed.length} changed, ${plan.deleted.length} deleted.`);
    },
  }),
  command("skills pull", {
    summary: "Download a visible Cloud skill to a local directory",
    args: {
      skill: arg.required({ valueLabel: "skill-id-or-slug" }),
      directory: arg.optional({ valueLabel: "directory" }),
    },
    flags: { force: flag.boolean(), dryRun: flag.boolean({ name: "dry-run" }) },
    async run({ ctx, args, flags }) {
      const skill = await resolveSkill(ctx, args.skill);
      const tree = await readSkillsApi<SkillTreeWire>(ctx, skillPath(skill.id, "/tree"));
      const destination = args.directory ?? skill.slug;
      const result = await writePulledTree(destination, tree.files, flags.force, flags.dryRun);
      printValue(ctx, { skill, contentHash: tree.contentHash, ...result }, `${skill.slug}: wrote ${result.written.length} file(s) to ${result.destination}.`);
    },
  }),
  command("skills code-review", {
    summary: "Request code review for a workspace skill",
    args: { skill: arg.required() },
    async run({ ctx, args }) {
      const skill = await resolveSkill(ctx, args.skill, true);
      printValue(ctx, await readSkillsApi(ctx, skillPath(skill.id, "/code-review"), { method: "POST" }), "Code review requested.");
    },
  }),
  ...(["approve", "revoke"] as const).map((action) =>
    command(`skills code-${action}`, {
      summary: `${action === "approve" ? "Approve" : "Revoke"} workspace skill code execution`,
      args: { skill: arg.required() },
      async run({ ctx, args }) {
        const skill = await resolveSkill(ctx, args.skill, true);
        const result = await readSkillsApi(ctx, skillPath(skill.id, `/code-${action}`), { method: "POST" });
        printValue(ctx, result, `Code ${action}d for ${skill.slug}.`);
      },
    }),
  ),
] as const;
