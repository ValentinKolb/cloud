import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(join(tmpdir(), "mail-app-integrations-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const [{ default: MailCalendarInvitation }, { default: MailConversationContext }] = await Promise.all([
  import("./MailCalendarInvitation.tsx"),
  import("./MailConversationContext.tsx"),
]);

describe("Mail app integration states", () => {
  test("exposes calendar invitation loading through the shared region contract", () => {
    const html = renderToString(() =>
      createComponent(MailCalendarInvitation, {
        mailboxId: "11111111-1111-4111-8111-111111111111",
        messageId: "22222222-2222-4222-8222-222222222222",
        requestUrl: "https://cloud.example.test/app/mail",
        canWrite: true,
        dateConfig: { locale: "en", timeZone: "Europe/Berlin" },
      }),
    );

    expect(html).toContain('class="k2b-placeholder');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Reading calendar invitation");
  });

  test("exposes Contacts and Spaces loading through the shared region contract", () => {
    const html = renderToString(() =>
      createComponent(MailConversationContext, {
        mailboxId: "11111111-1111-4111-8111-111111111111",
        conversationId: "33333333-3333-4333-8333-333333333333",
        requestUrl: "https://cloud.example.test/app/mail/11111111-1111-4111-8111-111111111111",
        active: true,
      }),
    );

    expect(html).toContain('class="k2b-placeholder');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading contacts...");
    expect(html).toContain("Loading Spaces...");
    expect(html).not.toContain("Spaces unavailable");
  });
});
