import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, CopyButton, prompts, SettingsGroup, toast } from "@k2b/ui";
import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./utils";

export function CalendarSection(props: { spaceId: string; icalToken: string | null; baseUrl: string; isAdmin: boolean }) {
  const [token, setToken] = createSignal(props.icalToken);

  const regenerateMut = mutations.create<{ icalToken: string }, { spaceId: string }>({
    mutation: async ({ spaceId }) => {
      const res = await apiClient[":id"]["regenerate-ical-token"].$post({ param: { id: spaceId } });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to regenerate token"));
      return res.json();
    },
    onSuccess: (data) => {
      setToken(data.icalToken);
      toast.success("iCal token regenerated");
    },
    onError: (err) => prompts.error(err.message),
  });
  let confirmPending = false;
  const confirmRegenerate = async () => {
    if (confirmPending || regenerateMut.loading()) return;
    confirmPending = true;
    try {
      const confirmed = await prompts.confirm("Regenerating the token will invalidate the current URL. Continue?", {
        title: "Regenerate Token",
        variant: "danger",
      });
      if (confirmed) void regenerateMut.mutate({ spaceId: props.spaceId });
    } finally {
      confirmPending = false;
    }
  };

  const icalUrl = () => (token() ? `${props.baseUrl}/api/spaces/calendar/ical/${token()}.ics` : null);

  return (
    <>
      <SettingsGroup title="Calendar feed" description="Subscribe to scheduled Space items from an external calendar.">
        <Show when={icalUrl()} fallback={<p class="text-sm text-dimmed">No calendar subscription URL is available.</p>}>
          <div class="flex min-w-0 items-center gap-2">
            <code class="min-w-0 flex-1 truncate rounded-[var(--ui-radius-control)] bg-[var(--ui-field)] px-2 py-1.5 text-xs text-secondary">
              {icalUrl()!}
            </code>
            <CopyButton text={icalUrl()!} />
          </div>
        </Show>
        <Show when={props.isAdmin && icalUrl()}>
          <SettingsGroup.Action>
            <Button type="button" variant="ghost" size="sm" onClick={() => void confirmRegenerate()} disabled={regenerateMut.loading()}>
              <i class={`ti ${regenerateMut.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
              Regenerate URL
            </Button>
          </SettingsGroup.Action>
        </Show>
      </SettingsGroup>

      <SettingsGroup title="Calendar apps" description="Use the subscription URL as a read-only calendar feed.">
        <div class="space-y-1 text-sm text-secondary">
          <p>
            <strong>Thunderbird:</strong> New Calendar → On the Network → iCalendar (ICS)
          </p>
          <p>
            <strong>Google Calendar:</strong> Settings → Add calendar → From URL
          </p>
          <p>
            <strong>Apple Calendar:</strong> File → New Calendar Subscription
          </p>
          <p>
            <strong>Outlook:</strong> Add calendar → Subscribe from web
          </p>
        </div>
      </SettingsGroup>
    </>
  );
}
