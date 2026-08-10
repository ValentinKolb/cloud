export const AI_CHAT_ENRICHMENT_INSTRUCTIONS_SETTING_KEY = "ai.chat_enrichment_instructions";
export const AI_MEMORY_LEARNING_INSTRUCTIONS_SETTING_KEY = "ai.memory_learning_instructions";
export const AI_COMPACTION_INSTRUCTIONS_SETTING_KEY = "ai.compaction_instructions";

/**
 * Background prompts share one contract: Cloud owns the task and output rules;
 * admins may add deployment context without replacing either boundary.
 */
export const buildAiTaskPrompt = (input: {
  baseInstructions: string;
  additionalInstructions?: string | null;
  outputContract: string;
}): string => {
  const additional = input.additionalInstructions?.trim();
  return [
    `# Task\n${input.baseInstructions.trim()}`,
    additional ? `# Additional organization guidance\n${additional}` : "",
    `# Fixed output contract\n${input.outputContract.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
};
