import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { bindMailWorkflow } from "../workflows/binder";
import { buildMailWorkflowCatalog } from "../workflows/catalog";
import { mailWorkflowManifest } from "../workflows/manifest";
import { mailHelp } from ".";

const expectedIds = [
  "mail-start",
  "mail-work",
  "mail-compose",
  "mail-collaboration",
  "mail-admin",
  "mail-automation",
  "mail-workflows",
  "mail-troubleshooting",
];

describe("mailHelp", () => {
  test("serves the task-oriented Mail help collection", async () => {
    expect(mailHelp.manifest.map((document) => document.id)).toEqual(expectedIds);

    const expectedContent = new Map([
      ["mail-start", "Mail organizes email around **mailboxes**"],
      ["mail-work", "Use **Search mailbox** for a quick search"],
      ["mail-compose", "Only one editing session holds the draft lease"],
      ["mail-collaboration", "Internal comments are visible to people who can read the mailbox"],
      ["mail-admin", "Pause mailbox** stops incoming synchronization"],
      ["mail-automation", "Reference-number settings define the format"],
      ["mail-workflows", "Mail workflow YAML has three top-level keys"],
      ["mail-troubleshooting", 'Sending says "Mailbox transport is paused"'],
    ]);

    for (const [id, text] of expectedContent) {
      const response = await mailHelp.router.request(`/${id}`);
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.markdown).toContain(text);
    }
  });

  test("documents permission-scoped Contacts context", () => {
    const collaboration = mailHelp.getMarkdown("mail-collaboration");
    expect(collaboration).toContain("Multiple Contacts can match the same address");
    expect(collaboration).toContain("Add as contact");
    expect(collaboration).toContain("multiple writable books");
    expect(collaboration).toContain("Mail stores no Contact ownership");
    expect(collaboration).toContain("contact-history");
  });

  test("keeps every internal help link on a registered Mail topic", () => {
    const registered = new Set(expectedIds);
    for (const id of expectedIds) {
      const markdown = mailHelp.getMarkdown(id);
      expect(markdown).toBeDefined();
      const links = markdown!.matchAll(/\/app\/mail\/help\/([a-z0-9-]+)/g);
      for (const link of links) expect(registered.has(link[1]!)).toBe(true);
    }
  });

  test("registers the same help on every Mail workspace route", async () => {
    const routes = [
      "../frontend/page.tsx",
      "../frontend/compose/page.tsx",
      "../frontend/[mailboxId]/page.tsx",
      "../frontend/[mailboxId]/automations/page.tsx",
      "../frontend/[mailboxId]/automations/replies/page.tsx",
      "../frontend/[mailboxId]/automations/rules/page.tsx",
      "../frontend/[mailboxId]/automations/activity/page.tsx",
      "../frontend/[mailboxId]/automations/workflows/page.tsx",
      "../frontend/[mailboxId]/compose/[draftId]/page.tsx",
    ];

    for (const route of routes) {
      const source = await Bun.file(new URL(route, import.meta.url)).text();
      expect(source).toContain("<MailLayoutHelp documents={mailHelp.manifest} />");
    }
  });

  test("finds operational recovery topics through help search", async () => {
    const response = await mailHelp.router.request("/search?q=paused");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ids).toContain("mail-admin");
    expect(payload.ids).toContain("mail-troubleshooting");
  });

  test("documents public-link controls and queued storage snapshots", () => {
    const admin = mailHelp.getMarkdown("mail-admin");
    const work = mailHelp.getMarkdown("mail-work");

    expect(admin).toContain("Mailbox **Admin** access is required to create, list, or revoke a public attachment link");
    expect(admin).toContain("public URL is disclosed only once");
    expect(admin).toContain("optional password, expiry time, and maximum number of download sessions");
    expect(admin).toContain("including older active links");
    expect(admin).toContain("Cloud **Admin** access");
    expect(admin).toContain("Reconcile storage** queues a background reconciliation");
    expect(admin).toContain("continue to show the last completed snapshot until that job finishes");
    expect(admin).toContain("cld mail admin mailbox access list|grant|set|revoke");
    expect(work).toContain("Mailbox tools > Shared links");
  });

  test("documents the permission-safe message inspector and exact source export", () => {
    const work = mailHelp.getMarkdown("mail-work");

    expect(work).toContain("Inspect an individual message");
    expect(work).toContain("Download .eml");
    expect(work).toContain("complete byte-exact file");
    expect(work).toContain("Raw headers and `.eml` files can contain private");
    expect(work).toContain("source and `.eml` download are unavailable");
    expect(work).toContain("Spam diagnostics");
    expect(work).toContain("Cloud does not calculate or infer its own spam score");
    expect(work).toContain("Provider keywords");
  });

  test("documents safe HTML reading and the personal plain-text alternative", () => {
    const work = mailHelp.getMarkdown("mail-work");
    const admin = mailHelp.getMarkdown("mail-admin");

    expect(work).toContain("View as plain text");
    expect(work).toContain("safe HTML in light mode and plain text in dark mode");
    expect(work).toContain("Settings > Reading > Default message format");
    expect(work).toContain("Scripts, forms, embedded objects, external stylesheets");
    expect(admin).toContain("Reading** is available to every mailbox reader");
  });

  test("documents guided mail rules and resumable existing-message backfills", () => {
    const automation = mailHelp.getMarkdown("mail-automation");
    const work = mailHelp.getMarkdown("mail-work");

    expect(automation).toContain("Automations > Rules");
    expect(automation).toContain("up to eight ordered actions");
    expect(automation).toContain("mail rule catalog");
    expect(automation).toContain("shows it in the editor");
    expect(automation).toContain("resumable background backfill");
    expect(automation).toContain("skips messages already accepted");
    expect(automation).toContain("same workflow runtime");
    expect(work).toContain("Find all from this sender");
    expect(work).toContain("Mark all as read");
    expect(work).toContain("at most 100 unread matching messages");
    expect(work).toContain("Manage unsubscribe");
  });

  test("keeps every documented workflow example valid for the Mail vocabulary", async () => {
    const markdown = [mailHelp.getMarkdown("mail-automation"), mailHelp.getMarkdown("mail-workflows")].join("\n");
    const examples = [...markdown.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]!);
    const catalog = buildMailWorkflowCatalog({
      folders: [{ id: "10000000-0000-4000-8000-000000000001", name: "Invoices" }],
      assignableUsers: [{ id: "20000000-0000-4000-8000-000000000001", name: "Alice Example" }],
      senderIdentities: [{ id: "40000000-0000-4000-8000-000000000001", name: "Support" }],
    });

    expect(examples.length).toBeGreaterThanOrEqual(7);
    for (const source of examples) {
      const compiled = await compileWorkflow(source, mailWorkflowManifest);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) continue;
      expect((await bindMailWorkflow(compiled.ir, catalog)).ok).toBe(true);
    }
  });
});
