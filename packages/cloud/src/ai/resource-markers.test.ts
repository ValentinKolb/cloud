import { describe, expect, test } from "bun:test";
import { resourcesFromMessage, userContentWithEditedVisibleText, userVisibleTextFromMessage } from "./chat/message-utils";
import { aiResourceMarker, parseAiResourceMarker } from "./resource-markers";

describe("Cloud resource message markers", () => {
  test("renders a chip while hiding and preserving the trust marker for retry", () => {
    const marker = aiResourceMarker({
      ref: { type: "mail.draft", id: "D4F7K2" },
      title: "Quarterly update",
      icon: "ti ti-mail",
      href: "/app/mail/drafts/D4F7K2",
    });
    const message = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "Please improve this." },
        { type: "text" as const, text: marker },
      ],
    };

    expect(userVisibleTextFromMessage(message)).toBe("Please improve this.");
    expect(resourcesFromMessage(message)).toEqual([
      { ref: { type: "mail.draft", id: "D4F7K2" }, title: "Quarterly update", icon: "ti ti-mail", href: "/app/mail/drafts/D4F7K2" },
    ]);
    expect(userContentWithEditedVisibleText(message, "Make it concise.")).toEqual([
      { type: "text", text: "Make it concise." },
      { type: "text", text: marker },
    ]);
    expect(parseAiResourceMarker(marker)?.ref.id).toBe("D4F7K2");
  });

  test("rejects presentation metadata that is not safe to render as a Cloud attachment", () => {
    const marker = aiResourceMarker({
      ref: { type: "mail.draft", id: "D4F7K2" },
      href: "/app/mail/drafts/D4F7K2",
    });

    expect(parseAiResourceMarker(marker.replace("/app/mail/drafts/D4F7K2", "https://attacker.example/collect"))).toBeNull();
    expect(parseAiResourceMarker(marker.replace('"href"', '"unexpected":true,"href"'))).toBeNull();
    expect(() => aiResourceMarker({ ref: { type: "mail.draft", id: "D4F7K2" }, href: "https://attacker.example/collect" })).toThrow();
  });
});
