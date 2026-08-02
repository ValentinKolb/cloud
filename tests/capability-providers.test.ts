import { describe, expect, test } from "bun:test";
import { compileCapabilities } from "../packages/cloud/src/_internal/capabilities";
import { contactsCapabilities } from "../packages/contacts/src/capabilities";
import { filesCapabilities } from "../packages/files/src/capabilities";
import { gridsCapabilities } from "../packages/grids/src/capabilities";
import { mailCapabilities } from "../packages/mail/src/capabilities";
import { notebooksCapabilities } from "../packages/notebooks/src/capabilities";
import { pulseCapabilities } from "../packages/pulse/src/capabilities";
import { spacesCapabilities } from "../packages/spaces/src/capabilities";
import { venueCapabilities } from "../packages/venue/src/capabilities";
import { weatherCapabilities } from "../packages/weather/src/capabilities";

const providers = [
  ["contacts", contactsCapabilities, ["contacts.book", "contacts.contact", "contacts.note", "contacts.tag"]],
  ["files", filesCapabilities, ["files.directory", "files.file"]],
  ["grids", gridsCapabilities, ["grids.base", "grids.record", "grids.table", "grids.view"]],
  [
    "mail",
    mailCapabilities,
    [
      "mail.attachment",
      "mail.comment",
      "mail.conversation",
      "mail.delivery",
      "mail.draft",
      "mail.folder",
      "mail.mailbox",
      "mail.mailing-list",
      "mail.message",
      "mail.reminder",
      "mail.sender-identity",
      "mail.tag",
    ],
  ],
  ["notebooks", notebooksCapabilities, ["notebooks.note", "notebooks.notebook"]],
  ["pulse", pulseCapabilities, ["pulse.base", "pulse.resource", "pulse.saved_query", "pulse.source"]],
  ["spaces", spacesCapabilities, ["spaces.comment", "spaces.item", "spaces.space"]],
  ["venue", venueCapabilities, ["venue.assignment", "venue.shift", "venue.venue"]],
  ["weather", weatherCapabilities, ["weather.location"]],
] as const;

describe("capability provider inventory", () => {
  for (const [appId, definitions, expectedTypes] of providers) {
    test(`${appId} publishes its resource types and universal search query`, () => {
      const manifest = compileCapabilities(appId, definitions).manifest;
      expect(manifest.types.map((type) => type.id)).toEqual([...expectedTypes]);
      expect(manifest.queries.some((query) => query.universalSearch)).toBeTrue();
      expect(manifest.queries.find((query) => query.universalSearch)?.universalSearch?.tags.length).toBeGreaterThan(0);
    });

    test(`${appId} reviews every destructive or open-world action`, () => {
      const manifest = compileCapabilities(appId, definitions).manifest;
      for (const action of manifest.actions) {
        expect(Boolean(action.review), `${action.id} review`).toBe(action.destructive || action.openWorld);
      }
    });
  }

  test("Contacts publishes the idempotent create action", () => {
    const manifest = compileCapabilities("contacts", contactsCapabilities).manifest;
    expect(manifest.actions.find((action) => action.id === "contacts.contact.create")).toEqual(
      expect.objectContaining({
        approval: "once",
        idempotency: "required",
        destructive: false,
        openWorld: false,
      }),
    );
  });
});
