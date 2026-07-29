import { describe, expect, test } from "bun:test";
import type { MailRuleAction } from "../../contracts";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";
import {
  createMailRuleAction,
  mailRuleActionKindLabels,
  mailRuleActionKindsFor,
  mailRuleActionLabel,
  mailRuleDestinationFolders,
} from "./mail-rule-actions";

const catalog: MailWorkflowCatalogSnapshot = {
  folders: [
    { id: "00000000-0000-4000-8000-000000000001", name: "Inbox", role: "inbox" },
    { id: "00000000-0000-4000-8000-000000000002", name: "Junk", role: "junk" },
  ],
  assignableUsers: [{ id: "00000000-0000-4000-8000-000000000003", name: "Ada" }],
  localTags: [{ id: "00000000-0000-4000-8000-000000000004", name: "Customer", color: "#2563eb" }],
};

describe("mail rule action editor model", () => {
  test("offers one provider action and composable collaboration actions", () => {
    const actions: MailRuleAction[] = [{ kind: "mark_read" }];
    expect(mailRuleActionKindsFor({ actions, catalog })).toEqual(["add_local_tag", "assign_user", "set_status"]);
    expect(mailRuleActionKindsFor({ actions, catalog, index: 0 })).toContain("move_to_folder");
  });

  test("uses only general destinations and consumes unique catalog values", () => {
    expect(mailRuleDestinationFolders(catalog).map((folder) => folder.name)).toEqual(["Inbox"]);
    const actions: MailRuleAction[] = [{ kind: "add_local_tag", tagId: catalog.localTags![0]!.id }];
    expect(mailRuleActionKindsFor({ actions, catalog })).not.toContain("add_local_tag");
    expect(createMailRuleAction({ kind: "add_local_tag", actions, catalog })).toBeNull();
  });

  test("creates and labels catalog-backed actions", () => {
    expect(mailRuleActionKindLabels.add_local_tag).toBe("Add tag");
    const action = createMailRuleAction({ kind: "move_to_folder", actions: [], catalog });
    expect(action).toEqual({ kind: "move_to_folder", folderId: catalog.folders[0]!.id });
    expect(action && mailRuleActionLabel(action, catalog)).toBe("Move to Inbox");
    expect(mailRuleActionLabel({ kind: "add_local_tag", tagId: catalog.localTags![0]!.id }, catalog)).toBe("Add tag Customer");
  });
});
