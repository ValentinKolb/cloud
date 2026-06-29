import { z } from "zod";
import { defineAiTool } from "./tools";

const ToneSchema = z.enum(["neutral", "blue", "teal", "green", "amber", "red"]);

const parseJsonObjectString = (value: unknown) => {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
};

const TrendSchema = z.preprocess(
  parseJsonObjectString,
  z.object({
    label: z.string().min(1),
    value: z.string().min(1),
    direction: z.enum(["up", "down", "flat"]).default("flat"),
  }),
);

const StatCardSchema = z.object({
  kind: z.literal("stat_card"),
  title: z.string().min(1),
  value: z.string().min(1),
  caption: z.string().optional(),
  tone: ToneSchema.default("teal"),
  trend: TrendSchema.optional(),
});

const ChartCardSchema = z.object({
  kind: z.literal("chart"),
  title: z.string().min(1),
  chart: z.enum(["bar", "line", "donut"]).default("bar"),
  caption: z.string().optional(),
  tone: ToneSchema.default("blue"),
  data: z
    .array(z.object({ label: z.string().min(1), value: z.number(), color: z.string().optional() }))
    .min(1)
    .max(12),
});

const TableCardSchema = z.object({
  kind: z.literal("table"),
  title: z.string().min(1),
  caption: z.string().optional(),
  tone: ToneSchema.default("neutral"),
  columns: z.array(z.string().min(1)).min(1).max(6),
  rows: z.array(z.array(z.string()).min(1).max(6)).min(1).max(12),
});

export const CloudAiCardInputSchema = z.discriminatedUnion("kind", [StatCardSchema, ChartCardSchema, TableCardSchema]);
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
      "Render a safe visual block in the chat for small stat cards, compact charts, or small tables. Use this when a visual summary is clearer than plain text. Pass nested fields like trend as JSON objects, not escaped strings.",
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

export type CloudAiCardInput = z.infer<typeof CloudAiCardInputSchema>;
export type CloudAiCardOutput = z.infer<typeof CloudAiCardOutputSchema>;
export type CloudAiSurveyInput = z.infer<typeof CloudAiSurveyInputSchema>;
export type CloudAiSurveyOutput = z.infer<typeof CloudAiSurveyOutputSchema>;
