import { describe, expect, test } from "bun:test";

const source = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("table mutation policy UI contract", () => {
  test("uses progressive source choices and previews affected entry points", async () => {
    const dialog = await source("./MutationPolicyDialog.tsx");

    expect(dialog).toContain('title="Choose where record changes can start"');
    expect(dialog).toContain('label="All"');
    expect(dialog).toContain('label: "Direct editing and record API"');
    expect(dialog).toContain('label: "Forms"');
    expect(dialog).toContain('label: "Workflows and actions"');
    expect(dialog).toContain('["mutation-policy"].impact.$post');
    expect(dialog).toContain('title="What will stop working"');
    expect(dialog).toContain("confirmationPhrase: props.args.tableName");
    expect(dialog).toContain('title: "Freeze record changes?"');
  });

  test("keeps mutation policy in the table data-integrity settings", async () => {
    const settings = await source("./TableAdminDialogs.tsx");

    expect(settings).toContain('title="Data integrity"');
    expect(settings).toContain('title="Record changes"');
    expect(settings).toContain("openMutationPolicyDialog");
  });
});
