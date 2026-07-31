import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "../../api/client";
import { readApiError } from "./api-response";
import { buildSpacesEventHandoffHref } from "./mail-spaces-event-route";

export const openMessageAsSpacesEvent = async (params: { mailboxId: string; messageId: string; abortSignal: AbortSignal }) => {
  const response = await apiClient.mailboxes[":mailboxId"]["calendar-destinations"].$get(
    { param: { mailboxId: params.mailboxId } },
    { init: { signal: params.abortSignal } },
  );
  if (!response.ok) throw new Error(await readApiError(response, "Could not load Spaces calendars"));
  const destinations = await response.json();
  if (destinations.items.length === 0) throw new Error("No writable Space is available for this event.");

  const values = await prompts.form({
    title: "Create event in Spaces",
    icon: "ti ti-calendar-plus",
    fields: {
      spaceId: {
        type: "select",
        label: "Calendar Space",
        description: "Spaces will own the event; Mail only provides bounded context from this message.",
        options: destinations.items.map((space) => ({ id: space.id, label: space.name })),
        default: destinations.selectedSpaceId ?? destinations.items[0]!.id,
        required: true,
      },
    },
    confirmText: "Open Spaces",
  });
  if (!values || params.abortSignal.aborted) return;

  window.location.assign(
    buildSpacesEventHandoffHref({
      origin: window.location.origin,
      spaceId: values.spaceId,
      mailboxId: params.mailboxId,
      messageId: params.messageId,
    }),
  );
};
