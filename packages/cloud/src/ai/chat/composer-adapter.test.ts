import { describe, expect, test } from "bun:test";
import {
  aiChatAttachments,
  aiChatModelOptions,
  aiComposerAttachmentRecords,
  aiComposerFileAccept,
  aiComposerSendInput,
  readAiComposerFiles,
  type AiComposerAttachment,
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
        },
      ]),
    ).toEqual([
      {
        id: "vision",
        label: "Vision",
        description: "test/vision",
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

    expect(attachments.map((attachment) => attachment.data)).toEqual([
      image,
      uploaded,
    ]);
    expect(aiComposerAttachmentRecords(attachments)).toEqual([image, uploaded]);
    expect(
      aiComposerSendInput({
        text: "Review these",
        attachments,
      }),
    ).toEqual({
      message: "Review these",
      content: [
        { type: "text", text: "Review these" },
        { type: "file", data: "aW1n", mediaType: "image/png" },
      ],
      files: [file],
    });
  });

  test("keeps file policy in Cloud and rejects images for text-only models", async () => {
    const result = await readAiComposerFiles(
      [new File(["image"], "photo.png", { type: "image/png" })],
      { supportsVision: false },
    );

    expect(aiComposerFileAccept).toContain("image/png");
    expect(result.attachments).toEqual([]);
    expect(result.errors).toEqual([
      "photo.png: choose a vision-capable model before attaching images.",
    ]);
  });
});
