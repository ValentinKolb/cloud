import type { DateContext } from "@k2b/stdlib";
import { mutation } from "@k2b/stdlib/solid";
import { dialogCore, panelDialogFixedOptions, prompts, toast } from "@k2b/ui";
import { onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import { readResponseError } from "../../../lib/response";
import ItemForm, { type ItemFormData } from "../shared/ItemForm";
import { requestSpacesRouteNavigation } from "./workspace-events";

type Props = {
  spaceId: string;
  mailboxId: string;
  messageId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  dateConfig?: DateContext;
};

const cleanHandoffHref = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("create");
  url.searchParams.delete("mailbox");
  url.searchParams.delete("message");
  return `${url.pathname}${url.search}${url.hash}`;
};

export default function CreateEventFromMail(props: Props) {
  const createEvent = mutation.create<SpaceItem | null, void>({
    mutation: async (_input, { abortSignal }) => {
      const sourceResponse = await apiClient[":id"]["mail-event-source"].$post(
        {
          param: { id: props.spaceId },
          json: { mailboxId: props.mailboxId, messageId: props.messageId },
        },
        { init: { signal: abortSignal } },
      );
      if (!sourceResponse.ok) throw new Error(await readResponseError(sourceResponse, "Could not load the source message"));
      const source = await sourceResponse.json();
      if (abortSignal.aborted) return null;

      const result = await dialogCore.open<ItemFormData | null>(
        (close) => (
          <ItemForm
            spaceId={props.spaceId}
            columns={props.columns}
            tags={props.tags}
            defaults={{
              type: "event",
              columnId: props.columns[0]?.id,
              title: source.title,
              description: source.description,
            }}
            onSubmit={(data) => close(data)}
            onCancel={() => close(null)}
            title="Create event from mail"
            icon="ti ti-calendar-plus"
            dateConfig={props.dateConfig}
          />
        ),
        panelDialogFixedOptions,
      );
      if (!result || abortSignal.aborted) return null;

      const response = await apiClient[":id"].items.$post({
        param: { id: props.spaceId },
        json: {
          ...result,
          location: result.location ?? undefined,
          url: result.url ?? undefined,
          priority: result.priority ?? undefined,
          recurrence: result.recurrence ?? undefined,
        },
      });
      if (!response.ok) throw new Error(await readResponseError(response, "Could not create the event"));
      return response.json();
    },
    onSuccess: (item) => {
      if (!item) {
        window.history.replaceState(window.history.state, "", cleanHandoffHref());
        return;
      }
      toast.success("Event created in Spaces");
      const target = new URL(cleanHandoffHref(), window.location.origin);
      target.searchParams.set("item", item.id);
      requestSpacesRouteNavigation(`${target.pathname}${target.search}`);
    },
    onError: (error) => {
      window.history.replaceState(window.history.state, "", cleanHandoffHref());
      void prompts.error(error.message, { title: "Could not create event" });
    },
  });

  onMount(() => createEvent.mutate());
  onCleanup(() => createEvent.abort());
  return null;
}
