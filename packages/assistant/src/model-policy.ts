import type { AiModelPolicy } from "@valentinkolb/cloud/ai";

/** Assistant always needs tools so stored chat and Project images remain inspectable. */
export const assistantModelPolicy = {
  kind: "selectable",
  requiredCapabilities: ["streaming", "tools"],
} satisfies AiModelPolicy;
