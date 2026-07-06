import { z } from "zod";
import { createCloudAiWebExtractTool, createCloudAiWebSearchTool, isCloudAiFirecrawlConfigured } from "./firecrawl-tools";
import { defineAiTool } from "./tools";
import type { AiRuntimeTool } from "./types";

const ToneSchema = z.enum(["neutral", "blue", "teal", "green", "amber", "red"]);

export const CloudAiCardInputSchema = z.object({
  title: z.string().min(1),
  value: z.string().min(1),
  caption: z.string().optional(),
  tone: ToneSchema.default("teal"),
  trendLabel: z.string().min(1).optional(),
  trendValue: z.string().min(1).optional(),
  trendDirection: z.enum(["up", "down", "flat"]).default("flat"),
});
export const CloudAiCardOutputSchema = z.object({ displayed: z.boolean() });

const SurveyQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("single"),
    id: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean().default(false),
    options: z
      .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
      .min(2)
      .max(8),
  }),
  z.object({
    type: z.literal("multiple"),
    id: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean().default(false),
    options: z
      .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
      .min(2)
      .max(8),
  }),
  z.object({
    type: z.literal("text"),
    id: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean().default(false),
    placeholder: z.string().optional(),
  }),
  z.object({
    type: z.literal("rating"),
    id: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean().default(false),
    min: z.number().int().min(0).default(1),
    max: z.number().int().max(10).default(5),
  }),
]);

export const CloudAiSurveyInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  submitLabel: z.string().default("Submit"),
  questions: z.array(SurveyQuestionSchema).min(1).max(8),
});
export const CloudAiSurveyOutputSchema = z.object({
  submitted: z.boolean(),
  answers: z.record(z.string(), z.unknown()).default({}),
});

export const createCloudAiCardTool = () =>
  defineAiTool({
    name: "card",
    description:
      "Render one compact visual highlight card in the chat. Use it only for a single status, metric, KPI, or short result. Use normal markdown for tables, lists, comparisons, and longer explanations. Keep all fields flat; do not pass arrays or nested objects.",
    inputSchema: CloudAiCardInputSchema,
    outputSchema: CloudAiCardOutputSchema,
    approval: "never",
  }).clientView();

export const createCloudAiSurveyTool = () =>
  defineAiTool({
    name: "survey",
    description:
      "Ask the user for structured input inside the chat. Use only when the conversation needs explicit choices, ratings, or short form answers.",
    inputSchema: CloudAiSurveyInputSchema,
    outputSchema: CloudAiSurveyOutputSchema,
    approval: "never",
  }).clientInteraction();

export const createDefaultCloudAiTools = () => [createCloudAiCardTool(), createCloudAiSurveyTool()];

export const createConfiguredDefaultCloudAiTools = async (config?: {
  firecrawlApiKey?: string | null;
  fetch?: typeof fetch;
}) => {
  const tools: AiRuntimeTool[] = createDefaultCloudAiTools();
  const firecrawlConfigured =
    config && "firecrawlApiKey" in config ? Boolean(config.firecrawlApiKey?.trim()) : await isCloudAiFirecrawlConfigured();
  if (firecrawlConfigured) {
    tools.push(createCloudAiWebSearchTool({ apiKey: config?.firecrawlApiKey, fetch: config?.fetch }));
    tools.push(createCloudAiWebExtractTool({ apiKey: config?.firecrawlApiKey, fetch: config?.fetch }));
  }
  return tools;
};

export type CloudAiCardInput = z.infer<typeof CloudAiCardInputSchema>;
export type CloudAiCardOutput = z.infer<typeof CloudAiCardOutputSchema>;
export type CloudAiSurveyInput = z.infer<typeof CloudAiSurveyInputSchema>;
export type CloudAiSurveyOutput = z.infer<typeof CloudAiSurveyOutputSchema>;
