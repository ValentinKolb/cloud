import { describe, expect, test } from "bun:test";
import { contactsCapabilities } from "../packages/contacts/src/capabilities";
import { filesCapabilities } from "../packages/files/src/capabilities";
import { mailCapabilities } from "../packages/mail/src/capabilities";
import { notebooksCapabilities } from "../packages/notebooks/src/capabilities";
import { spacesCapabilities } from "../packages/spaces/src/capabilities";
import { weatherCapabilities } from "../packages/weather/src/capabilities";
import { compileCapabilities } from "../packages/cloud/src/_internal/capabilities";

const providers = [
  ["contacts", contactsCapabilities, ["contacts.contact"]],
  ["files", filesCapabilities, ["files.directory", "files.file"]],
  ["mail", mailCapabilities, ["mail.message"]],
  ["notebooks", notebooksCapabilities, ["notebooks.note", "notebooks.notebook"]],
  ["spaces", spacesCapabilities, ["spaces.item", "spaces.space"]],
  ["weather", weatherCapabilities, ["weather.location"]],
] as const;

describe("capability provider inventory", () => {
  for (const [appId, definitions, expectedTypes] of providers) {
    test(`${appId} publishes its resource types and universal search query`, () => {
      const manifest = compileCapabilities(appId, definitions).manifest;
      expect(manifest.types.map((type) => type.id)).toEqual([...expectedTypes]);
      expect(manifest.queries.filter((query) => query.universalSearch)).toHaveLength(1);
      expect(manifest.queries[0]?.universalSearch?.tags.length).toBeGreaterThan(0);
    });
  }

  test("Contacts publishes the idempotent create action", () => {
    const manifest = compileCapabilities("contacts", contactsCapabilities).manifest;
    expect(manifest.actions).toEqual([
      expect.objectContaining({
        id: "contacts.create",
        approval: "once",
        idempotency: "required",
        destructive: false,
        openWorld: false,
      }),
    ]);
  });
});
