import type { CloudResourceRef } from "../contracts/capabilities";
import {
  CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES,
  CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE,
  CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT,
  parseCloudResourceClipboard,
  serializeCloudResourceClipboard,
} from "../contracts/resource-clipboard";

export type CloudResourceClipboardWrite = {
  ref: CloudResourceRef;
  fallbackText: string;
};

export type CloudResourceClipboardItem = Pick<ClipboardItem, "types" | "getType">;

const supportsStructuredClipboard = (): boolean => {
  if (typeof ClipboardItem === "undefined" || typeof navigator.clipboard?.write !== "function") return false;
  return typeof ClipboardItem.supports !== "function" || ClipboardItem.supports(CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT);
};

export const writeCloudResourceClipboard = async ({ ref, fallbackText }: CloudResourceClipboardWrite): Promise<void> => {
  if (new TextEncoder().encode(fallbackText).byteLength > CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES || fallbackText.length === 0) {
    throw new TypeError(`fallbackText must contain between 1 and ${CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES} bytes`);
  }

  if (!supportsStructuredClipboard()) {
    await navigator.clipboard.writeText(fallbackText);
    return;
  }

  const payload = serializeCloudResourceClipboard(ref);
  await navigator.clipboard.write([
    new ClipboardItem({
      [CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT]: new Blob([payload], { type: CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE }),
      "text/plain": new Blob([fallbackText], { type: "text/plain" }),
    }),
  ]);
};

export const readCloudResourceClipboard = async (items?: readonly CloudResourceClipboardItem[]): Promise<CloudResourceRef | null> => {
  const clipboardItems = items ?? (await navigator.clipboard.read());

  for (const item of clipboardItems) {
    if (!item.types.includes(CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT)) continue;

    const blob = await item.getType(CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT);
    if (blob.size > CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES) continue;

    const ref = parseCloudResourceClipboard(await blob.text());
    if (ref) return ref;
  }

  return null;
};

export const cloudResourceClipboard = {
  mimeType: CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE,
  webFormat: CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT,
  parse: parseCloudResourceClipboard,
  serialize: serializeCloudResourceClipboard,
  write: writeCloudResourceClipboard,
  read: readCloudResourceClipboard,
} as const;
