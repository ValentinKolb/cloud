import { describe, expect, test } from "bun:test";
import { buildMailTriageInput, MAIL_COMMANDS, MAIL_TRIAGE_COMMAND_IDS } from "./mail-command-registry";

describe("Mail command registry", () => {
  test("keeps command ids and default shortcuts unique", () => {
    expect(new Set(MAIL_COMMANDS.map((command) => command.id)).size).toBe(MAIL_COMMANDS.length);
    const shortcuts = MAIL_COMMANDS.flatMap((command) => (command.defaultShortcut ? [command.defaultShortcut] : []));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(MAIL_TRIAGE_COMMAND_IDS.every((id) => MAIL_COMMANDS.some((command) => command.id === id))).toBe(true);
  });

  test("builds canonical state, role, and folder actions", () => {
    const common = {
      sourceFolderId: "source",
      idempotencyKey: "idempotency",
      correlationId: "correlation",
    };
    expect(buildMailTriageInput({ ...common, commandId: "mark_read" })).toMatchObject({
      kind: "change_state",
      change: { addFlags: ["seen"] },
    });
    expect(buildMailTriageInput({ ...common, commandId: "archive" })).toMatchObject({ kind: "move_to_role", role: "archive" });
    expect(
      buildMailTriageInput({
        ...common,
        commandId: "move",
        destinationFolderId: "destination",
      }),
    ).toMatchObject({
      kind: "move_to_folder",
      destinationFolderId: "destination",
    });
    expect(() => buildMailTriageInput({ ...common, commandId: "move" })).toThrow("Choose a destination folder");
  });
});
