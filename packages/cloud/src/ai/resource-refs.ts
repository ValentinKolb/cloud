import { type CloudResourceRef, CloudResourceRefSchema, type CloudResourceView, CloudResourceViewSchema } from "../contracts/capabilities";
import type { AiConversationResourceObservation } from "./types";

const observationKey = (ref: CloudResourceRef): string => `${ref.type}\0${ref.id}`;

export const isConversationResourceCursor = (value: string, scope: "conversation" | "user"): boolean => {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    return (
      typeof parsed.at === "string" &&
      !Number.isNaN(Date.parse(parsed.at)) &&
      typeof parsed.type === "string" &&
      parsed.type.length > 0 &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0 &&
      (scope === "user" ? typeof parsed.chat === "string" && parsed.chat.length > 0 : parsed.chat === undefined)
    );
  } catch {
    return false;
  }
};

/** Collect only schema-valid structured refs; never infer identities from text. */
export const collectConversationResourceObservations = (...values: unknown[]): AiConversationResourceObservation[] => {
  const observations = new Map<string, AiConversationResourceObservation>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const view = CloudResourceViewSchema.safeParse(value);
    if (view.success) {
      const resource: CloudResourceView = view.data;
      observations.set(observationKey(resource.ref), {
        ref: resource.ref,
        title: resource.title,
        preview: resource.preview,
        icon: resource.icon,
        href: resource.links.find((link) => link.rel === "open")?.href,
      });
    } else {
      const ref = CloudResourceRefSchema.safeParse(value);
      if (ref.success && !observations.has(observationKey(ref.data))) observations.set(observationKey(ref.data), { ref: ref.data });
    }

    for (const nested of Object.values(value as Record<string, unknown>)) visit(nested);
  };

  for (const value of values) visit(value);
  return [...observations.values()];
};
