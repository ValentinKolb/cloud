import { describe, expect, test } from "bun:test";

describe("record finalization UI contract", () => {
  test("keeps readiness, confirmation, and immutable state on the record detail surface", async () => {
    const source = await Bun.file(new URL("./RecordDetailPanel.tsx", import.meta.url)).text();

    expect(source).toContain(".finalization.$get");
    expect(source).toContain(".finalize.$post");
    expect(source).toContain('title: "Finalize record?"');
    expect(source).toContain("After finalization, this record and its files and relations can no longer be changed or removed.");
    expect(source).toContain("!rec.finalizedAt");
    expect(source).toContain("showFinalizationStatus={Boolean(rec.finalizedAt || finalization()?.enabled)}");
  });

  test("keeps activation next to Durable History with shared feedback and confirmation", async () => {
    const source = await Bun.file(new URL("../dialogs/TableAdminDialogs.tsx", import.meta.url)).text();

    expect(source).toContain('title="History and protection"');
    expect(source).toContain("<NoticeCard");
    expect(source).toContain(".finalization.enable.$post");
    expect(source).toContain(".finalization.disable.$post");
    expect(source).toContain('title: operation === "enable" ? "Enable record finalization?" : "Disable record finalization?"');
  });

  test("does not expose finalized Custom App records as editable", async () => {
    const source = await Bun.file(new URL("../../custom-app/RecordDetails.island.tsx", import.meta.url)).text();

    expect(source).toContain("!record().finalizedAt");
    expect(source).toContain("canWrite={editableFieldIds.has(field.id) && !record().finalizedAt}");
  });

  test("shows a calm Draft or Finalized status only for opted-in live records", async () => {
    const source = await Bun.file(new URL("./RecordReadView.tsx", import.meta.url)).text();

    expect(source).toContain('mode() === "live" && props.showFinalizationStatus');
    expect(source).toContain('props.record.finalizedAt ? "Finalized" : "Draft"');
  });
});
