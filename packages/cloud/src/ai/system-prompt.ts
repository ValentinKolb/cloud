import type { User } from "../contracts/shared";
import { logger } from "../services/logging";
import { type AiSkillPromptHint, type AiToolPromptHint, aiPromptContext, renderAiPlatformPrompt } from "../shared/ai-platform-prompt";
import { renderLiquidTemplate } from "../shared/template-rendering";

const log = logger("ai:system-prompt");

/** Minimal fallback when the platform template itself fails to render (a code bug, not admin input). */
const PLATFORM_FALLBACK_PROMPT = [
  "You are Cloud AI, an assistant running inside the user's Cloud workspace.",
  "Never invent facts, data, or access you don't have. Only claim access to data or actions the server context or tools actually provide.",
  "Answer in the user's language. Keep answers short for simple questions.",
].join("\n");

/** Liquid context available to the admin-configured global instructions. */
export const aiGlobalInstructionsContext = (input: {
  user?: Pick<User, "displayName" | "uid" | "mail">;
  appId?: string;
  now?: Date;
}): Record<string, unknown> => aiPromptContext(input);

/** Render the admin global instructions as Liquid; fall back to the raw template on render errors. */
export const renderAiGlobalInstructions = (template: string, context: Record<string, unknown>): string => {
  const trimmed = template.trim();
  if (!trimmed) return "";
  try {
    return renderLiquidTemplate(trimmed, context, { escapeOutput: false }).trim();
  } catch (error) {
    log.warn("AI global instructions failed to render; using raw template", {
      error: error instanceof Error ? error.message : String(error),
    });
    return trimmed;
  }
};

export type AiSystemPromptInput = {
  /** Admin-configured global instructions (Liquid template). */
  globalInstructions: string;
  /** App-level prompt from the chat route or resource. */
  appPrompt?: string;
  resourceContext?: string;
  user?: Pick<User, "displayName" | "uid" | "mail">;
  appId?: string;
  /** Adds memory rules and the Memories section (with the memory tool available). */
  memoryEnabled?: boolean;
  /** One-line usage hints of the tools actually available this turn. */
  toolHints?: AiToolPromptHint[];
  /** One-line index of the user's active skills (mounted at /skills in the bash tool). */
  skillHints?: AiSkillPromptHint[];
  /** User-authored custom instructions from their AI preferences. */
  userInstructions?: string;
  /** The user's memory block; only rendered when memoryEnabled. */
  memory?: string;
  now?: Date;
};

/**
 * Compose the full system prompt for a chat turn:
 * platform (Liquid: identity, runtime, rules, tools, memory rules) →
 * admin global (Liquid) → app prompt → resource context →
 * user instructions → memories.
 */
export const composeAiSystemPrompt = (input: AiSystemPromptInput): string => {
  const contextInput = {
    user: input.user,
    appId: input.appId,
    memoryEnabled: input.memoryEnabled,
    tools: input.toolHints,
    skills: input.skillHints,
    now: input.now,
  };

  let platform: string;
  try {
    platform = renderAiPlatformPrompt(contextInput);
  } catch (error) {
    log.error("AI platform prompt failed to render; using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    platform = PLATFORM_FALLBACK_PROMPT;
  }

  const userInstructions = input.userInstructions?.trim();
  const memory = input.memory?.trim();

  const sections = [
    platform,
    renderAiGlobalInstructions(input.globalInstructions, aiPromptContext(contextInput)),
    input.appPrompt?.trim(),
    input.resourceContext?.trim(),
    userInstructions ? `## User preferences\nThe user asked you to keep the following in mind:\n${userInstructions}` : undefined,
    input.memoryEnabled ? `## Memories\n${memory ? memory : "(no memories yet)"}` : undefined,
  ];

  return sections.filter(Boolean).join("\n\n");
};
