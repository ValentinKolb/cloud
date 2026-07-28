import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { migrateMailWorkflowSourceToLiquid } from "./liquid-template-migration";

describe("Mail workflow Liquid migration", () => {
  test("rewrites only declared text-template fields", () => {
    const migrated = migrateMailWorkflowSourceToLiquid(`
steps:
  - automaticReply:
      message: "\${{ inputs.message }}"
      conversation: "\${{ inputs.conversation }}"
      sender: Support
      subject: "Re: \${{ inputs.message.subject }}"
      body: "Reference \${{ reference.value }}"
`);
    expect(migrated.migratedTemplates).toBe(2);
    expect(parse(migrated.source)).toMatchObject({
      steps: [
        {
          automaticReply: {
            message: "${{ inputs.message }}",
            conversation: "${{ inputs.conversation }}",
            subject: "Re: {{ inputs.message.subject }}",
            body: "Reference {{ reference.value }}",
          },
        },
      ],
    });
  });
});
