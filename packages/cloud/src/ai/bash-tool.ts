import { Bash, MountableFs } from "just-bash";
import { z } from "zod";
import { PgConversationFs, type SkillFsFile, SkillsFs } from "./bash-fs";
import { builtinAiSkillCommands } from "./builtin-skills";
import { aiFileStore } from "./files-store";
import { aiSkillStore, type AiSkillUserView } from "./skills-store";
import { defineAiTool } from "./tools";

const BASH_TIMEOUT_MS = 60_000;
const BASH_MAX_RESULT_CHARS = 30_000;

/** Skill files that may execute: only mounted when the skill's code is admin-approved. */
const isExecutableSkillFile = (path: string): boolean => /\.(js|mjs|cjs|ts|py|sh)$/.test(path) || path.includes("/scripts/");

const truncate = (text: string, label: string): string =>
  text.length <= BASH_MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, BASH_MAX_RESULT_CHARS)}\n[${label} truncated: ${text.length} chars total — write to a file under /files and read it in slices instead]`;

/**
 * Materialize the /skills mount for one user: every active (enabled +
 * consented) skill appears as /skills/<slug>/…, plus a generated README.md
 * index. Executable files are only mounted for code-approved skills — the
 * store revokes allow_code on any file change, so the approval always refers
 * to the exact tree being mounted.
 */
/** Materialize the /skills mount from an already-loaded active-skill list. */
export const buildAiSkillsMountFromSkills = async (skills: AiSkillUserView[]): Promise<SkillsFs> => {
  const files: SkillFsFile[] = [];

  for (const skill of skills) {
    const stats = await aiSkillStore.listFiles(skill.id);
    for (const stat of stats) {
      if (!skill.allowCode && isExecutableSkillFile(stat.path)) continue;
      files.push({
        path: `/${skill.slug}${stat.path}`,
        size: stat.size,
        mtime: new Date(stat.updatedAt),
        read: async () => {
          const file = await aiSkillStore.readFile(skill.id, stat.path);
          if (!file) throw new Error(`Skill file disappeared: ${stat.path}`);
          return file.bytes;
        },
      });
    }
  }

  const readme = renderSkillsReadme(skills);
  const readmeBytes = new TextEncoder().encode(readme);
  files.push({ path: "/README.md", size: readmeBytes.byteLength, read: async () => readmeBytes });

  return new SkillsFs(files);
};

export const buildAiSkillsMount = async (input: { userId: string; userGroups: string[] }): Promise<SkillsFs> =>
  buildAiSkillsMountFromSkills(await aiSkillStore.activeSkills(input));

const renderSkillsReadme = (skills: AiSkillUserView[]): string => {
  const lines = [
    "# Skills",
    "",
    "Each directory under /skills is one skill. Read its SKILL.md first — it explains",
    "when the skill applies and how to use its references, assets, and scripts.",
    "",
  ];
  if (skills.length === 0) lines.push("_No skills are active for this user._");
  for (const skill of skills) {
    lines.push(`- \`/skills/${skill.slug}/SKILL.md\` — ${skill.description}`);
  }
  return `${lines.join("\n")}\n`;
};

/** One-line skill index for the system prompt (progressive disclosure: details live in SKILL.md). */
export const listActiveAiSkillHints = async (input: {
  userId: string;
  userGroups: string[];
}): Promise<{ slug: string; description: string }[]> => {
  const skills = await aiSkillStore.activeSkills(input);
  return skills.map((skill) => ({ slug: skill.slug, description: skill.description }));
};

export const buildAiBashFs = (input: { conversationId: string; skills: SkillsFs }): MountableFs => {
  const fs = new MountableFs();
  fs.mount("/files", new PgConversationFs({ conversationId: input.conversationId, dbPrefix: "/files" }));
  fs.mount("/input", new PgConversationFs({ conversationId: input.conversationId, dbPrefix: "/input", readOnly: true }));
  fs.mount("/skills", input.skills);
  return fs;
};

export const CloudAiBashInputSchema = z.object({
  command: z.string().min(1).describe("The bash command to run. Pipes, redirects, loops, and heredocs are supported."),
  stdin: z.string().optional().describe("Optional text piped to the command's standard input."),
});
export const CloudAiBashOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  /** Conversation-file changes caused by this command (diffed against ai.files). */
  files: z
    .object({
      created: z.array(z.string()),
      updated: z.array(z.string()),
      deleted: z.array(z.string()),
    })
    .optional(),
});

const FILE_DIFF_MAX_ENTRIES = 20;

type FileSnapshot = Map<string, string>;

const snapshotFiles = async (conversationId: string): Promise<FileSnapshot> => {
  const stats = await aiFileStore.list({ conversationId });
  return new Map(stats.map((stat) => [stat.path, `${stat.size}:${stat.updatedAt}`]));
};

const diffFiles = (before: FileSnapshot, after: FileSnapshot) => {
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  for (const [path, fingerprint] of after) {
    if (!before.has(path)) created.push(path);
    else if (before.get(path) !== fingerprint) updated.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) deleted.push(path);
  }
  if (created.length + updated.length + deleted.length === 0) return undefined;
  return {
    created: created.slice(0, FILE_DIFF_MAX_ENTRIES),
    updated: updated.slice(0, FILE_DIFF_MAX_ENTRIES),
    deleted: deleted.slice(0, FILE_DIFF_MAX_ENTRIES),
  };
};

export const createCloudAiBashTool = () =>
  defineAiTool({
    name: "bash",
    description: [
      "Run a command in a sandboxed bash environment (simulated in-process: no host, no network).",
      "Filesystem: /files (read-write workspace, persists for this conversation), /input (read-only user uploads), /skills (read-only skill library — start with /skills/README.md).",
      "Standard tools are available (grep, sed, awk, jq, sort, head, tail, wc, sqlite3, …) plus `js-exec` for sandboxed JavaScript (js-exec script.js, or js-exec -c 'code'; require(\"fs\") works on the same virtual filesystem).",
      "Environment variables and cwd do not persist between calls; files under /files do.",
      "Work incrementally on large files: use head/tail/sed ranges and write intermediate results to /files instead of printing everything.",
    ].join(" "),
    inputSchema: CloudAiBashInputSchema,
    outputSchema: CloudAiBashOutputSchema,
    approval: "never",
    timeoutMs: BASH_TIMEOUT_MS + 5_000,
    promptHint:
      "run sandboxed bash over the conversation files (/files rw, /input uploads ro, /skills library ro) — for inspecting, transforming, and generating files.",
  }).server(async (input, ctx) => {
    if (!ctx.conversationId) throw new Error("The bash tool needs a conversation context.");
    if (ctx.actor.kind !== "user") throw new Error("The bash tool is only available to signed-in users.");
    const user = ctx.actor.user;

    const activeSkills = await aiSkillStore.activeSkills({ userId: user.id, userGroups: user.memberofGroupIds });
    const skills = await buildAiSkillsMountFromSkills(activeSkills);
    const fs = buildAiBashFs({ conversationId: ctx.conversationId, skills });

    const bash = new Bash({
      fs,
      cwd: "/files",
      env: { HOME: "/files", USER: user.uid },
      javascript: true,
      // Builtin skill commands follow the skill's activation — disable calc, lose calc.
      customCommands: builtinAiSkillCommands(new Set(activeSkills.map((skill) => skill.slug))),
      executionLimits: { maxOutputSize: 2 * 1024 * 1024, maxJsTimeoutMs: 20_000 },
    });

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), BASH_TIMEOUT_MS);
    const before = await snapshotFiles(ctx.conversationId);
    try {
      const result = await bash.exec(input.command, { stdin: input.stdin, signal: abort.signal });
      const files = diffFiles(before, await snapshotFiles(ctx.conversationId));
      return {
        stdout: truncate(result.stdout, "stdout"),
        stderr: truncate(result.stderr, "stderr"),
        exitCode: result.exitCode,
        ...(files ? { files } : {}),
      };
    } catch (error) {
      // Interpreter-level failures (e.g. a redirection onto a read-only mount,
      // storage caps) throw out of exec — surface them like a failed command.
      if (abort.signal.aborted) {
        return { stdout: "", stderr: `Command timed out after ${Math.round(BASH_TIMEOUT_MS / 1000)}s.`, exitCode: 124 };
      }
      return { stdout: "", stderr: truncate(error instanceof Error ? error.message : String(error), "stderr"), exitCode: 1 };
    } finally {
      clearTimeout(timer);
    }
  });

export const CloudAiPresentInputSchema = z.object({
  path: z.string().min(1).describe("Absolute VFS path of the file to present, e.g. /files/report.csv."),
  title: z.string().min(1).optional().describe("Optional short title shown above the file."),
});
export const CloudAiPresentOutputSchema = z.object({
  path: z.string(),
  size: z.number(),
  mediaType: z.string(),
});

export const createCloudAiPresentTool = () =>
  defineAiTool({
    name: "present",
    description:
      "Present a file from the conversation filesystem to the user as a downloadable chat attachment. Use it for results you produced under /files (exports, reports, generated documents) — not for text that belongs in your answer.",
    inputSchema: CloudAiPresentInputSchema,
    outputSchema: CloudAiPresentOutputSchema,
    approval: "never",
    promptHint: "hand a produced file (e.g. /files/out.csv) to the user as a download card.",
  }).server(async (input, ctx) => {
    if (!ctx.conversationId) throw new Error("The present tool needs a conversation context.");
    const path = input.path.startsWith("/") ? input.path : `/files/${input.path}`;
    if (!path.startsWith("/files/") && !path.startsWith("/input/")) {
      throw new Error("Only files under /files or /input can be presented.");
    }
    const stat = await aiFileStore.stat({ conversationId: ctx.conversationId, path });
    if (!stat) throw new Error(`No such file: ${path}`);
    return { path: stat.path, size: stat.size, mediaType: stat.mediaType };
  });
