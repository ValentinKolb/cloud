import { describe, expect, test } from "bun:test";
import type { CapabilityDefinitions } from "../packages/cloud/src/contracts/capabilities";
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

const providers: ReadonlyArray<{
  appId: string;
  definitions: CapabilityDefinitions;
  types: readonly string[];
  searches: readonly string[];
}> = [
  {
    appId: "contacts",
    definitions: contactsCapabilities,
    types: ["book", "contact", "note", "tag"],
    searches: ["contact.search"],
  },
  { appId: "files", definitions: filesCapabilities, types: ["directory", "file"], searches: ["search"] },
  {
    appId: "grids",
    definitions: gridsCapabilities,
    types: ["base", "record", "table", "view"],
    searches: ["base.search"],
  },
  {
    appId: "mail",
    definitions: mailCapabilities,
    types: [
      "attachment",
      "comment",
      "conversation",
      "delivery",
      "draft",
      "folder",
      "mailbox",
      "mailing-list",
      "message",
      "reminder",
      "sender-identity",
      "tag",
    ],
    searches: ["search"],
  },
  { appId: "notebooks", definitions: notebooksCapabilities, types: ["note", "notebook"], searches: ["note.search", "notebook.search"] },
  {
    appId: "pulse",
    definitions: pulseCapabilities,
    types: ["base", "resource", "saved_query", "source"],
    searches: ["base.search", "resource.search"],
  },
  {
    appId: "spaces",
    definitions: spacesCapabilities,
    types: ["comment", "item", "space"],
    searches: ["item.search", "space.search"],
  },
  { appId: "venue", definitions: venueCapabilities, types: ["assignment", "shift", "venue"], searches: ["venue.search"] },
  { appId: "weather", definitions: weatherCapabilities, types: ["location"], searches: ["location.search"] },
];

const consumers = [
  ["Core HTTP catalog and dispatcher", "packages/cloud/src/api/capabilities.test.ts"],
  ["browser and server clients", "packages/cloud/src/capabilities/client.test.ts"],
  ["generic CLI", "packages/cloud/src/cli/capabilities.test.ts"],
  ["Capabilities app", "packages/capabilities/src/invocation.test.ts"],
  ["Universal Search", "packages/cloud/src/api/search.test.ts"],
  ["MCP", "packages/cloud/src/api/mcp.test.ts"],
  ["Assistant discovery and approval", "packages/cloud/src/ai/capabilities.test.ts"],
  ["Assistant execution", "packages/cloud/src/ai/capability-execution.test.ts"],
  ["Mail to Contacts browser integration", "packages/mail/src/frontend/_components/contact-capabilities.ts"],
  ["Mail to Spaces server integration", "packages/mail/src/service/app-integrations.ts"],
  ["Spaces to Mail server integration", "packages/spaces/src/service/mail-integration.ts"],
] as const;

describe("Capability v1 provider conformance", () => {
  for (const provider of providers) {
    test(`${provider.appId} compiles the frozen manifest and focused searches`, () => {
      const manifest = compileCapabilities(provider.appId, provider.definitions).manifest;
      expect(manifest.protocolVersion).toBe(1);
      expect(manifest.types.map((type) => type.localId)).toEqual(provider.types);
      expect(manifest.queries.filter((query) => query.universalSearch).map((query) => query.localId)).toEqual(provider.searches);
      expect(new Set([...manifest.types, ...manifest.queries, ...manifest.actions].map((entry) => entry.localId)).size).toBe(
        manifest.types.length + manifest.queries.length + manifest.actions.length,
      );
      for (const action of manifest.actions) {
        expect(Boolean(action.review), `${provider.appId}.${action.localId} review`).toBe(action.destructive || action.openWorld);
        expect(["none", "required"]).toContain(action.idempotency);
      }
    });
  }

  test("required-idempotency Actions remain an explicit inventory", () => {
    const required = providers.flatMap(({ appId, definitions }) =>
      compileCapabilities(appId, definitions).manifest.actions.flatMap((action) =>
        action.idempotency === "required" ? [`${appId}.${action.localId}`] : [],
      ),
    );
    expect(required).toEqual([
      "contacts.contact.create",
      "contacts.note.create",
      "mail.conversation.mark",
      "mail.conversation.move",
      "mail.draft.create",
      "mail.draft.send",
      "spaces.event.invitation.prepare",
    ]);
  });
});

describe("Capability v1 consumer conformance matrix", () => {
  for (const [surface, evidence] of consumers) {
    test(`${surface} has focused live-checkout coverage`, async () => {
      expect(await Bun.file(new URL(`../${evidence}`, import.meta.url)).exists(), evidence).toBe(true);
    });
  }
});
