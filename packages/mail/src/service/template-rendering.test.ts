import { describe, expect, test } from "bun:test";
import {
  escapeMailMarkdownValue,
  migrateReferenceTemplateToLiquid,
  migrateWorkflowTextTemplateToLiquid,
  renderMailLiquidTemplate,
  renderMailWorkflowTemplate,
  validateMailLiquidTemplate,
} from "./template-rendering";

describe("Mail Liquid templates", () => {
  test("renders strict text and Mail filters", () => {
    expect(renderMailLiquidTemplate("REF-{{ year }}-{{ sequence | pad_start: 6 }}", { year: 2026, sequence: 42n })).toEqual({
      ok: true,
      data: "REF-2026-000042",
    });
  });

  test("escapes values inserted into Markdown", () => {
    expect(escapeMailMarkdownValue("*Hello* <script>")).toBe("&#42;Hello&#42; &lt;script&gt;");
    expect(renderMailLiquidTemplate("Hello {{ name }}", { name: "**admin**" }, "markdown")).toEqual({
      ok: true,
      data: "Hello &#42;&#42;admin&#42;&#42;",
    });
  });

  test("rejects unknown roots and invalid filters", () => {
    expect(validateMailLiquidTemplate("{{ actor.email }}", { allowedRoots: ["mailbox"] })).toMatchObject({ ok: false });
    expect(validateMailLiquidTemplate("{{ actor.email | missing_filter }}")).toMatchObject({ ok: false });
  });

  test("renders workflow inputs, context, and saved step values from one snapshot", () => {
    const rendered = renderMailWorkflowTemplate(
      {
        invocation: {
          workflowId: "workflow",
          mode: "execute",
          channel: "mail",
          actor: { userId: "user" },
          inputs: { message: { subject: "Request" } },
          idempotencyKey: "run",
          occurredAt: "2026-07-28T12:00:00.000Z",
          context: { mailboxId: "mailbox" },
        },
        variableSnapshot: () => ({ reference: { value: "REF-42" } }),
      },
      "{{ inputs.message.subject }} / {{ context.mailboxId }} / {{ reference.value }}",
    );

    expect(rendered).toBe("Request / mailbox / REF-42");
  });

  test("migrates embedded workflow expressions", () => {
    expect(migrateWorkflowTextTemplateToLiquid("Re: ${{ inputs.message.subject }} / ${{ reference.value }}")).toBe(
      "Re: {{ inputs.message.subject }} / {{ reference.value }}",
    );
  });

  test("migrates legacy reference tokens", () => {
    expect(migrateReferenceTemplateToLiquid("REF-{year}-{sequence:6}")).toBe("REF-{{ year }}-{{ sequence | pad_start: 6 }}");
    expect(migrateReferenceTemplateToLiquid("REF-{{year}}-{sequence}")).toBe("REF-{{year}}-{{ sequence }}");
  });
});
