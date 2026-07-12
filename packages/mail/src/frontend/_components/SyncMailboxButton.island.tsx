import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "../../api/client";
import { readApiError } from "./api-response";

export default function SyncMailboxButton(props: { mailboxId: string; class?: string; label?: string }) {
  const sync = mutations.create<void, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"].sync.$post({ param: { mailboxId: props.mailboxId } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to queue synchronization"));
    },
    onSuccess: () => toast.success("Synchronization queued"),
    onError: (error) => prompts.error(error.message),
  });
  return (
    <button
      type="button"
      class={props.class ?? "btn-secondary btn-sm"}
      onClick={() => sync.mutate()}
      disabled={sync.loading()}
      title="Synchronize mailbox"
    >
      <i class={`ti ti-refresh ${sync.loading() ? "animate-spin" : ""}`} />
      {props.label ?? "Sync"}
    </button>
  );
}
