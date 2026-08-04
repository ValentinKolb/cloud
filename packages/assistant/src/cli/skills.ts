import type { AiSkill, AiSkillSummary } from "@valentinkolb/cloud/ai";
import { arg, type CloudCliContext, command, confirmFlag, flag, readCliInput } from "@valentinkolb/cloud/cli";
import { jsonRequest, printRows, printValue, readSkillsApi, requireConfirmation } from "./shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const basePath = (workspace: boolean): string => (workspace ? "/admin" : "/");
const skillPath = (skillId: string, workspace: boolean): string => `${workspace ? "/admin" : ""}/${encodeURIComponent(skillId)}`;

const listSkills = (ctx: CloudCliContext, workspace: boolean): Promise<{ skills: AiSkillSummary[] }> =>
  readSkillsApi(ctx, basePath(workspace));

export const resolveAssistantSkill = async (ctx: CloudCliContext, reference: string, workspace = false): Promise<AiSkillSummary> => {
  if (UUID_RE.test(reference)) {
    const detail = await readSkillsApi<{ skill: AiSkill }>(ctx, skillPath(reference, workspace));
    return detail.skill;
  }
  const { skills } = await listSkills(ctx, workspace);
  const matches = skills.filter((skill) => skill.name.localeCompare(reference, undefined, { sensitivity: "accent" }) === 0);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Multiple skills are named "${reference}". Use the skill ID.`);
  throw new Error(`Unknown skill "${reference}". Use its exact name or ID.`);
};

const readInstructions = async (value: Parameters<typeof readCliInput>[0], required: boolean): Promise<string | undefined> =>
  readCliInput(value, { label: "skill instructions", required, trimFinalNewline: true });

export const assistantSkillCommands = [
  command("skills list", {
    summary: "List visible or workspace skills",
    flags: { workspace: flag.boolean({ description: "List the admin-managed workspace catalog" }) },
    async run({ ctx, flags }) {
      const result = await listSkills(ctx, flags.workspace);
      printRows(
        ctx,
        result,
        result.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          scope: skill.scope,
          enabled: skill.enabled ? "yes" : "no",
          revision: skill.revision,
          description: skill.description,
        })),
        [{ key: "id" }, { key: "name" }, { key: "scope" }, { key: "enabled" }, { key: "revision" }, { key: "description" }],
      );
    },
  }),
  command("skills get", {
    summary: "Show one skill",
    args: { skill: arg.required({ valueLabel: "skill-id-or-name" }) },
    flags: { workspace: flag.boolean({ description: "Read from the admin workspace catalog" }) },
    async run({ ctx, args, flags }) {
      const skill = await resolveAssistantSkill(ctx, args.skill, flags.workspace);
      printValue(ctx, await readSkillsApi(ctx, skillPath(skill.id, flags.workspace)));
    },
  }),
  command("skills create", {
    summary: "Create a text-only skill",
    args: { name: arg.required() },
    flags: {
      description: flag.string(),
      instructions: flag.input({ required: true, description: "Instructions text or --instructions-file" }),
      workspace: flag.boolean({ description: "Create an admin-managed workspace skill" }),
    },
    async run({ ctx, args, flags }) {
      const instructions = await readInstructions(flags.instructions, true);
      const result = await readSkillsApi<{ skill: AiSkill }>(
        ctx,
        basePath(flags.workspace),
        jsonRequest("POST", { name: args.name, description: flags.description ?? "", instructions }),
      );
      printValue(ctx, result, `${result.skill.id}\t${result.skill.name}`);
    },
  }),
  command("skills update", {
    summary: "Update a text-only skill",
    args: { skill: arg.required({ valueLabel: "skill-id-or-name" }) },
    flags: {
      name: flag.string(),
      description: flag.string(),
      instructions: flag.input({ description: "Instructions text or --instructions-file" }),
      workspace: flag.boolean({ description: "Update an admin-managed workspace skill" }),
    },
    async run({ ctx, args, flags }) {
      const skill = await resolveAssistantSkill(ctx, args.skill, flags.workspace);
      const instructions = await readInstructions(flags.instructions, false);
      const changes = {
        ...(flags.name !== undefined ? { name: flags.name } : {}),
        ...(flags.description !== undefined ? { description: flags.description } : {}),
        ...(instructions !== undefined ? { instructions } : {}),
      };
      if (Object.keys(changes).length === 0) throw new Error("Supply --name, --description, or --instructions.");
      const result = await readSkillsApi<{ skill: AiSkill }>(ctx, skillPath(skill.id, flags.workspace), jsonRequest("PATCH", changes));
      printValue(ctx, result, `Updated ${result.skill.name}.`);
    },
  }),
  command("skills delete", {
    summary: "Delete a personal or workspace skill",
    args: { skill: arg.required({ valueLabel: "skill-id-or-name" }) },
    flags: {
      workspace: flag.boolean({ description: "Delete an admin-managed workspace skill" }),
      yes: confirmFlag("Confirm deleting the skill"),
    },
    async run({ ctx, args, flags }) {
      requireConfirmation(flags.yes, "Deleting a skill");
      const skill = await resolveAssistantSkill(ctx, args.skill, flags.workspace);
      const result = await readSkillsApi(ctx, skillPath(skill.id, flags.workspace), { method: "DELETE" });
      printValue(ctx, result, `Deleted ${skill.name}.`);
    },
  }),
  ...(["enable", "disable"] as const).map((action) =>
    command(`skills ${action}`, {
      summary: `${action === "enable" ? "Enable" : "Disable"} a workspace skill`,
      args: { skill: arg.required({ valueLabel: "skill-id-or-name" }) },
      async run({ ctx, args }) {
        const skill = await resolveAssistantSkill(ctx, args.skill, true);
        const result = await readSkillsApi<{ skill: AiSkill }>(
          ctx,
          skillPath(skill.id, true),
          jsonRequest("PATCH", { enabled: action === "enable" }),
        );
        printValue(ctx, result, `${action === "enable" ? "Enabled" : "Disabled"} ${result.skill.name}.`);
      },
    }),
  ),
] as const;
