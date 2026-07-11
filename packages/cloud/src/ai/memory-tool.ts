import { z } from "zod";
import { aiPrefsUserId, aiUserPrefs } from "./prefs";
import { defineAiTool } from "./tools";

export const CloudAiMemoryInputSchema = z.object({
  action: z.enum(["add", "remove"]),
  content: z
    .string()
    .min(1)
    .max(500)
    .describe("For add: one short, self-contained fact to remember. For remove: text matching the memory line(s) to delete."),
});
export const CloudAiMemoryOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export type CloudAiMemoryInput = z.infer<typeof CloudAiMemoryInputSchema>;
export type CloudAiMemoryOutput = z.infer<typeof CloudAiMemoryOutputSchema>;

export const createCloudAiMemoryTool = () =>
  defineAiTool({
    name: "memory",
    description: [
      "Update your persistent memory of the user (shown to you under 'Memories').",
      "Use action 'add' when the user shares a lasting fact, preference, or project, or explicitly asks you to remember something.",
      "Use action 'remove' when a memory is outdated or the user asks you to forget something; content matches the memory text to delete.",
      "Keep each memory one short sentence. Lines are date-stamped automatically — do not add dates yourself.",
      "Do not store secrets, credentials, or trivial conversational details.",
    ].join(" "),
    inputSchema: CloudAiMemoryInputSchema,
    outputSchema: CloudAiMemoryOutputSchema,
    approval: "never",
    promptHint: "add or remove lasting facts about the user (see Memory section).",
  }).server(async (input, ctx) => {
    const userId = aiPrefsUserId(ctx.actor);
    if (!userId) return { ok: false, message: "Memory is not available for this actor." };

    if (input.action === "add") {
      const stored = await aiUserPrefs.addMemory(userId, input.content);
      if (!stored) return { ok: false, message: "Memory is full or the entry was empty. Remove outdated memories first." };
      return { ok: true, message: `Remembered: ${stored}` };
    }

    const removed = await aiUserPrefs.removeMemory(userId, input.content);
    if (removed.length === 0) return { ok: false, message: "No matching memory found." };
    return { ok: true, message: `Forgot ${removed.length} memor${removed.length === 1 ? "y" : "ies"}: ${removed.join(" | ")}` };
  });
