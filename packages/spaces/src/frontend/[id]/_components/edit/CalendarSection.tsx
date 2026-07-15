import { CopyButton, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./utils";

export function CalendarSection(props: { spaceId: string; icalToken: string | null; baseUrl: string; isAdmin: boolean }) {
  const [token, setToken] = createSignal(props.icalToken);

  const regenerateMut = mutations.create({
    mutation: async () => {
      const confirmed = await prompts.confirm("Regenerating the token will invalidate the current URL. Continue?", {
        title: "Regenerate Token",
        variant: "danger",
      });
      if (!confirmed) return null;

      const res = await apiClient[":id"]["regenerate-ical-token"].$post({
        param: { id: props.spaceId },
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to regenerate token"));
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (!data) return;
      setToken((data as { icalToken: string }).icalToken);
      toast.success("iCal token regenerated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const icalUrl = () => (token() ? `${props.baseUrl}/api/spaces/calendar/ical/${token()}.ics` : null);

  return (
    <div class="flex flex-col gap-3">
      <Show when={icalUrl()} fallback={<p class="text-sm text-dimmed">No iCal token available.</p>}>
        <div class="flex min-w-0 items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded-[var(--ui-radius-control)] bg-[var(--ui-field)] px-2 py-1.5 text-xs text-secondary">
            {icalUrl()!}
          </code>
          <CopyButton text={icalUrl()!} />
        </div>
        <div class="text-xs text-dimmed space-y-1">
          <p>
            <strong>Thunderbird:</strong> New Calendar -&gt; On the Network -&gt; iCalendar (ICS)
          </p>
          <p>
            <strong>Google Calendar:</strong> Settings -&gt; Add calendar -&gt; From URL
          </p>
          <p>
            <strong>Apple Calendar:</strong> File -&gt; New Calendar Subscription
          </p>
          <p>
            <strong>Outlook:</strong> Add calendar -&gt; Subscribe from web
          </p>
        </div>
        <Show when={props.isAdmin}>
          <button
            type="button"
            onClick={() => regenerateMut.mutate(undefined)}
            disabled={regenerateMut.loading()}
            class="text-xs text-red-500 hover:text-red-600 self-start"
          >
            {regenerateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Regenerate token"}
          </button>
        </Show>
      </Show>
    </div>
  );
}
