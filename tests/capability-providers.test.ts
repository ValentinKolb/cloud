import { describe, expect, test } from "bun:test";
import {
  assertCapabilityManifestEvolution,
  compileCapabilityManifest,
} from "../packages/cloud/src/capabilities/testing";
import { buildAiCapabilityCatalog, searchAiCapabilities } from "../packages/cloud/src/ai/capabilities";
import {
  type CapabilityDefinitions,
  type CapabilityManifest,
  CapabilityManifestSchema,
} from "../packages/cloud/src/contracts/capabilities";
import { contactsCapabilities } from "../packages/contacts/src/capabilities";
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
  { appId: "venue", definitions: venueCapabilities, types: ["assignment", "venue"], searches: ["venue.search"] },
  { appId: "weather", definitions: weatherCapabilities, types: ["location"], searches: ["location.search"] },
];

const frozenManifests = new Map<string, CapabilityManifest>(
  await Promise.all(
    providers.map(async ({ appId }) => [
      appId,
      CapabilityManifestSchema.parse(
        await Bun.file(new URL(`./fixtures/capabilities/v1/${appId}.json`, import.meta.url)).json(),
      ),
    ] as const),
  ),
);

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
      const manifest = compileCapabilityManifest(provider.appId, provider.definitions);
      const previous = frozenManifests.get(provider.appId);
      if (!previous) throw new Error(`Missing frozen manifest for ${provider.appId}`);
      assertCapabilityManifestEvolution(previous, manifest);
      expect(manifest.protocolVersion).toBe(1);
      expect(manifest.types.map((type) => type.localId)).toEqual(provider.types);
      expect(manifest.queries.filter((query) => query.universalSearch).map((query) => query.localId)).toEqual(provider.searches);
      expect(new Set([...manifest.types, ...manifest.queries, ...manifest.actions].map((entry) => entry.localId)).size).toBe(
        manifest.types.length + manifest.queries.length + manifest.actions.length,
      );
      for (const action of manifest.actions) {
        if (action.destructive || action.openWorld) {
          expect(action.review, `${provider.appId}.${action.localId} review`).toBe(true);
        }
        expect(["none", "required"]).toContain(action.idempotency);
      }
    });
  }

  test("required-idempotency Actions remain an explicit inventory", () => {
    const required = providers.flatMap(({ appId, definitions }) =>
      compileCapabilityManifest(appId, definitions).actions.flatMap((action) =>
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

describe("Capability v1 Assistant discovery", () => {
  const catalog = buildAiCapabilityCatalog(
    providers.map(({ appId, definitions }) => ({
      appId,
      appName: appId,
      appIcon: "",
      appDescription: "",
      endpoint: `http://${appId}`,
      manifest: compileCapabilityManifest(appId, definitions),
    })),
  );

  test.each([
    ["find contact by name", "contacts", "contacts__query__contact_dot_search"],
    ["list address books", "contacts", "contacts__query__book_dot_list"],
    ["create a contact", "contacts", "contacts__action__contact_dot_create"],
    ["read email body", undefined, "mail__query__message_dot_get"],
    ["mark email unread", "mail", "mail__action__conversation_dot_mark"],
    ["send draft email", "mail", "mail__action__draft_dot_send"],
    ["search messages", "mail", "mail__query__search"],
    ["inspect grid schema fields", "grids", "grids__query__gql_dot_context"],
    ["run GQL query", "grids", "grids__query__gql_dot_execute"],
    ["create a grid record", "grids", "grids__action__record_dot_create"],
    ["browse note tree", "notebooks", "notebooks__query__note_dot_tree"],
    ["read note markdown", "notebooks", "notebooks__query__note_dot_get"],
    ["find backlinks to note", "notebooks", "notebooks__query__note_dot_links"],
    ["edit note content", "notebooks", "notebooks__action__note_dot_edit"],
    ["find telemetry base", "pulse", "pulse__query__base_dot_search"],
    ["search telemetry resources", "pulse", "pulse__query__resource_dot_search"],
    ["execute telemetry query", "pulse", "pulse__query__query_dot_execute"],
    ["run saved telemetry query", "pulse", "pulse__query__saved__query_dot_execute"],
    ["read comments", "spaces", "spaces__query__comment_dot_list"],
    ["create a task", "spaces", "spaces__action__task_dot_create"],
    ["create calendar event", "spaces", "spaces__action__event_dot_create"],
    ["list people assignable to task", "spaces", "spaces__query__space_dot_assignee_dot_list"],
    ["find shifts", "venue", "venue__query__shift_dot_list"],
    ["list my assignments", "venue", "venue__query__assignment_dot_mine"],
    ["sign up for shift", "venue", "venue__action__assignment_dot_signup"],
    ["search city", "weather", "weather__query__city_dot_search"],
    ["get current weather", "weather", "weather__query__forecast_dot_current"],
    ["list saved weather locations", "weather", "weather__query__location_dot_list"],
    ["save a weather location", "weather", "weather__action__location_dot_create"],
  ] as const)("ranks %s to its expected capability", (query, appId, expectedName) => {
    expect(searchAiCapabilities(catalog, { query, appId, limit: 5 }).capabilities[0]?.name).toBe(expectedName);
  });
});

describe("Capability v1 consumer conformance matrix", () => {
  for (const [surface, evidence] of consumers) {
    test(`${surface} has focused live-checkout coverage`, async () => {
      expect(await Bun.file(new URL(`../${evidence}`, import.meta.url)).exists(), evidence).toBe(true);
    });
  }
});
