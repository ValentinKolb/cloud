import { z } from "zod";
import { type CloudResourceRef, CloudResourceRefSchema } from "./capabilities";

export const CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE = "application/vnd.k2b.cloud-resource-ref+json";
export const CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT = `web ${CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE}`;
export const CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES = 4_096;

export const CloudResourceClipboardPayloadSchema = z
  .object({
    version: z.literal(1),
    ref: CloudResourceRefSchema,
  })
  .strict();

export type CloudResourceClipboardPayload = z.infer<typeof CloudResourceClipboardPayloadSchema>;

export const serializeCloudResourceClipboard = (ref: CloudResourceRef): string =>
  JSON.stringify(CloudResourceClipboardPayloadSchema.parse({ version: 1, ref }));

export const parseCloudResourceClipboard = (value: string): CloudResourceRef | null => {
  if (new TextEncoder().encode(value).byteLength > CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES) return null;

  try {
    const payload = CloudResourceClipboardPayloadSchema.safeParse(JSON.parse(value));
    return payload.success ? payload.data.ref : null;
  } catch {
    return null;
  }
};
