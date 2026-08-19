import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { editTextWithExternalEditor, parseEditorCommand } from "./text-editor";

describe("Assistant CLI text editor", () => {
  test("parses editor arguments without invoking a shell", () => {
    expect(parseEditorCommand("code --wait --reuse-window")).toEqual(["code", "--wait", "--reuse-window"]);
    expect(parseEditorCommand('"/Applications/My Editor.app/editor" --wait')).toEqual(["/Applications/My Editor.app/editor", "--wait"]);
    expect(parseEditorCommand("editor 'unterminated")).toBeNull();
  });

  test("round-trips Markdown through a cleaned temporary file", async () => {
    let path = "";
    const result = await editTextWithExternalEditor(
      { title: "Review", content: "# Initial", format: "markdown", submitLabel: "Continue" },
      {
        editor: "editor --wait",
        run: async (command, draftPath) => {
          expect(command).toEqual(["editor", "--wait"]);
          expect(draftPath.endsWith("draft.md")).toBe(true);
          path = draftPath;
          await writeFile(draftPath, "# Edited\n", "utf8");
          return 0;
        },
      },
    );

    expect(result).toEqual({ submitted: true, content: "# Edited\n", format: "markdown" });
    expect(existsSync(path)).toBe(false);
  });

  test("rejects oversized editor output and still cleans up", async () => {
    let path = "";
    await expect(
      editTextWithExternalEditor(
        { title: "Review", content: "Initial", format: "plain", submitLabel: "Continue" },
        {
          editor: "editor",
          run: async (_command, draftPath) => {
            path = draftPath;
            await writeFile(draftPath, "x".repeat(20_001), "utf8");
            return 0;
          },
        },
      ),
    ).rejects.toThrow("20,000 character limit");
    expect(existsSync(path)).toBe(false);
  });
});
