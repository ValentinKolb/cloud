import { prompts } from "@valentinkolb/cloud/ui";
import type { CreateAttachmentLinkInput } from "../../contracts";

export const promptAttachmentLinkOptions = async (): Promise<CreateAttachmentLinkInput | null> => {
  const values = await prompts.form({
    title: "Share attachment",
    icon: "ti ti-link",
    confirmText: "Create link",
    fields: {
      info: {
        type: "info",
        content: "Anyone with the link can download this attachment until you revoke it or a limit is reached.",
      },
      expiresAt: { type: "datetime", label: "Expires", description: "Optional. Leave empty for no expiry." },
      password: {
        type: "text",
        label: "Password",
        description: "Optional, at least 8 characters. Share it separately from the link.",
        password: true,
        minLength: 8,
      },
      maxDownloads: {
        type: "number",
        label: "Maximum downloads",
        description: "Optional. Leave empty for no download limit.",
        min: 1,
        max: 1_000_000,
      },
    },
  });
  if (!values) return null;
  return {
    expiresAt: values.expiresAt || null,
    password: values.password || null,
    maxDownloads: values.maxDownloads ?? null,
  };
};
