import { describe, expect, test } from "bun:test";
import {
  type AiComposerAttachment,
  aiChatAttachments,
  aiChatModelOptions,
  aiComposerAttachmentRecords,
  aiComposerFileAccept,
  aiComposerSendInput,
  readAiComposerFiles,
} from "./composer-adapter";

describe("Cloud chat composer adapter", () => {
  test("maps model profiles without leaking the Cloud profile contract", () => {
    expect(
      aiChatModelOptions([
        {
          id: "vision",
          label: "Vision",
          provider: "openrouter",
          model: "test/vision",
          capabilities: ["streaming", "vision"],
          dataBoundary: "private",
          contextWindow: 128_000,
          image: "https://example.test/provider.svg",
        },
      ]),
    ).toEqual([
      {
        id: "vision",
        label: "Vision",
        description: "test/vision",
        image: "https://example.test/provider.svg",
        icon: "ti ti-photo-spark",
        capabilities: ["streaming", "vision"],
      },
    ]);
  });

  test("round-trips application-owned attachment data into the controller input", () => {
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    const image: AiComposerAttachment = {
      kind: "image",
      id: "image",
      name: "photo.png",
      size: 4,
      mediaType: "image/png",
      data: "aW1n",
      file,
    };
    const uploaded: AiComposerAttachment = {
      kind: "file",
      id: "file",
      name: "notes.txt",
      size: file.size,
      mediaType: file.type,
      file,
      icon: "ti-file-text",
    };
    const attachments = aiChatAttachments([image, uploaded]);

    expect(attachments.map((attachment) => attachment.data)).toEqual([image, uploaded]);
    expect(aiComposerAttachmentRecords(attachments)).toEqual([image, uploaded]);
    expect(
      aiComposerSendInput({
        intent: "send",
        text: "Review these",
        attachments,
      }),
    ).toEqual({
      message: "Review these",
      content: [{ type: "text", text: "Review these" }],
      files: [file, file],
    });
  });

  test("round-trips a linked Cloud resource as an attachment without duplicating its icon class", () => {
    const resource: AiComposerAttachment = {
      kind: "resource",
      id: "resource:mail.draft:D4F7K2",
      name: "Quarterly update",
      ref: { type: "mail.draft", id: "D4F7K2" },
      icon: "ti ti-mail",
      href: "/app/mail/drafts/D4F7K2",
    };
    const attachments = aiChatAttachments([resource]);

    expect(attachments).toEqual([
      {
        id: resource.id,
        name: resource.name,
        size: undefined,
        kind: "resource",
        icon: "ti ti-mail",
        previewUrl: undefined,
        href: resource.href,
        data: resource,
      },
    ]);
    expect(aiComposerSendInput({ intent: "send", text: "", attachments })).toEqual({
      message: undefined,
      content: undefined,
      files: undefined,
      resources: [{ ref: resource.ref, title: resource.name, icon: resource.icon, href: resource.href }],
      storedFiles: undefined,
    });
  });

  test("keeps file policy in Cloud and rejects images without a vision path", async () => {
    const result = await readAiComposerFiles([new File(["image"], "photo.png", { type: "image/png" })], { acceptsImages: false });

    expect(aiComposerFileAccept).toContain("image/png");
    expect(result.attachments).toEqual([]);
    expect(result.errors).toEqual(["photo.png: choose a Vision model or configure the view_image fallback."]);
  });

  test("preflights the aggregate image limit across composer selections", async () => {
    const result = await readAiComposerFiles([new File(["image"], "photo.png", { type: "image/png" })], {
      acceptsImages: true,
      currentImageBytes: 40 * 1024 * 1024,
    });
    expect(result.attachments).toEqual([]);
    expect(result.errors[0]).toContain("40 MB total limit");
  });
});
