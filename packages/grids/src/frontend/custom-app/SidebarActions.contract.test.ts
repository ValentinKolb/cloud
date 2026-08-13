import { describe, expect, test } from "bun:test";

describe("Grids App sidebar launchers", () => {
  test("uses shared workspace, dialog, form, workflow polling, and toast primitives", async () => {
    const source = await Bun.file(new URL("./SidebarActions.island.tsx", import.meta.url)).text();
    expect(source).toContain("AppWorkspace.SidebarItem");
    expect(source).toContain("dialogCore.open");
    expect(source).toContain("<PanelDialog>");
    expect(source).toContain("panelDialogOptions");
    expect(source).not.toContain("panelDialogWideOptions");
    expect(source).toContain("<FormSubmit");
    expect(source).toContain("invokeCustomAppWorkflow");
    expect(source).toContain("toast.success");
    expect(source).toContain("toast.error");
    expect(source).toContain("prompts.confirm");
    expect(source).not.toContain("window.confirm");
  });
});
