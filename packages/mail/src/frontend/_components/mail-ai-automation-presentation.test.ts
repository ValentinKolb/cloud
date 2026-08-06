import { describe, expect, test } from "bun:test";
import type { MailAiAutomationDefinition } from "../../contracts";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";
import {
  initialMailAiAutomationDefinition,
  mailAiAutomationCatalogIssue,
  mailAiAutomationResultLabel,
  nextMailAiAutomationName,
  sortMailAiAutomations,
} from "./mail-ai-automation-presentation";

const ids = {
  folder: "00000000-0000-4000-8000-000000000001",
  tag: "00000000-0000-4000-8000-000000000002",
  secondTag: "00000000-0000-4000-8000-000000000003",
  user: "00000000-0000-4000-8000-000000000004",
  sender: "00000000-0000-4000-8000-000000000005",
};

const catalog: MailWorkflowCatalogSnapshot = {
  folders: [{ id: ids.folder, name: "Customers" }],
  localTags: [
    { id: ids.tag, name: "Finance" },
    { id: ids.secondTag, name: "Urgent" },
  ],
  assignableUsers: [{ id: ids.user, name: "Ada" }],
  senderIdentities: [{ id: ids.sender, name: "Support <support@example.com>" }],
};

describe("guided Mail AI automation presentation", () => {
  test("builds usable defaults and unique names", () => {
    expect(initialMailAiAutomationDefinition("tag", catalog)).toMatchObject({ kind: "tag", maxTags: 2, tags: [{}, {}] });
    expect(nextMailAiAutomationName("route", [])).toBe("Route with AI");
    expect(nextMailAiAutomationName("route", [{ name: "route with ai" }, { name: "Route with AI 2" }])).toBe("Route with AI 3");
  });

  test("surfaces catalog drift before a save or activation", () => {
    const route: MailAiAutomationDefinition = {
      kind: "route",
      prompt: "Route the message.",
      categories: [
        { name: "Customer", description: "Customer mail", actions: [{ kind: "move_to_folder", folderId: ids.folder }] },
        { name: "Other", description: "Everything else", actions: [{ kind: "set_status", status: "needs_action" }] },
      ],
    };
    expect(mailAiAutomationCatalogIssue(route, catalog)).toBeNull();
    expect(
      mailAiAutomationCatalogIssue(
        {
          ...route,
          categories: [
            { ...route.categories[0]!, actions: [{ kind: "move_to_folder", folderId: crypto.randomUUID() }] },
            route.categories[1]!,
          ],
        },
        catalog,
      ),
    ).toBe("Customer: Choose an available destination folder.");

    const draft = initialMailAiAutomationDefinition("draft", catalog);
    expect(mailAiAutomationCatalogIssue(draft, { ...catalog, senderIdentities: [] })).toContain("verified sender identity");
  });

  test("keeps list order and result labels predictable", () => {
    const definition = initialMailAiAutomationDefinition("tag", catalog);
    expect(mailAiAutomationResultLabel(definition, catalog)).toBe("Finance · Urgent");
    expect(
      sortMailAiAutomations([
        { name: "Beta", enabled: false },
        { name: "Zulu", enabled: true },
        { name: "Alpha", enabled: true },
      ]).map((item) => item.name),
    ).toEqual(["Alpha", "Zulu", "Beta"]);
  });
});
