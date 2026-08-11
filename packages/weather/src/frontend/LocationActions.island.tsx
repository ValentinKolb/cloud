import { navigateTo } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import { Button, Dropdown, prompts, SegmentedControl, toast } from "@k2b/ui";
import { createSignal, onCleanup } from "solid-js";
import { apiClient } from "@/api/client";
import { buildDisplayUrl, type DisplaySettings } from "./params";

function DisplaySettingsForm(props: { onSubmit: (settings: DisplaySettings) => void }) {
  const [zoom, setZoom] = createSignal<"1" | "2" | "3">("2");
  const [theme, setTheme] = createSignal<"light" | "dark">("dark");
  const [view, setView] = createSignal<"simple" | "detail">("simple");

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    props.onSubmit({
      zoom: Number.parseInt(zoom(), 10) as 1 | 2 | 3,
      theme: theme(),
      detail: view() === "detail",
    });
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">Zoom level</p>
        <SegmentedControl
          value={zoom}
          onValueChange={setZoom}
          options={[
            { value: "1", label: "Small" },
            { value: "2", label: "Medium" },
            { value: "3", label: "Large" },
          ]}
        />
      </div>

      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">Theme</p>
        <SegmentedControl
          value={theme}
          onValueChange={setTheme}
          options={[
            { value: "light", label: "Light", icon: "ti ti-sun" },
            { value: "dark", label: "Dark", icon: "ti ti-moon" },
          ]}
        />
      </div>

      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">View</p>
        <SegmentedControl
          value={view}
          onValueChange={setView}
          options={[
            { value: "simple", label: "Simple", icon: "ti ti-layout-bottombar" },
            { value: "detail", label: "Detailed", icon: "ti ti-layout-grid" },
          ]}
        />
      </div>

      <Button type="submit" variant="secondary" class="mt-4 self-end">
        <i class="ti ti-external-link" aria-hidden="true" />
        Open display
      </Button>
    </form>
  );
}

export default function LocationActions(props: { id: string; lat: number; lon: number }) {
  const [confirmingRemove, setConfirmingRemove] = createSignal(false);
  let disposed = false;
  const remove = mutation.create<boolean, { id: string }>({
    mutation: async ({ id }, { abortSignal }) => {
      const response = await apiClient.locations[":id"].$delete({ param: { id } }, { init: { signal: abortSignal } });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : "Failed to remove location",
        );
      }
      return true;
    },
    onSuccess: (removed) => {
      if (!removed) return;
      toast.success("Location removed");
      navigateTo("/app/weather");
    },
    onError: (error) => prompts.error(error.message),
  });

  onCleanup(() => {
    disposed = true;
    remove.abort();
  });

  const removeLocation = async () => {
    if (confirmingRemove() || remove.loading()) return;
    const id = props.id;
    setConfirmingRemove(true);
    try {
      const confirmed = await prompts.confirm("Remove this location?", {
        title: "Remove location",
        variant: "danger",
      });
      if (!disposed && confirmed) await remove.mutate({ id });
    } finally {
      if (!disposed) setConfirmingRemove(false);
    }
  };
  const removing = () => confirmingRemove() || remove.loading();

  const openDisplay = () => {
    prompts.dialog(
      (close) => (
        <DisplaySettingsForm
          onSubmit={(settings) => {
            window.open(buildDisplayUrl(props.lat, props.lon, settings), "_blank");
            close(null);
          }}
        />
      ),
      { title: "Display settings", icon: "ti ti-device-tv" },
    );
  };

  return (
    <div class="flex items-center gap-2" role="group" aria-label="Location actions">
      <Button type="button" variant="secondary" size="sm" onClick={openDisplay}>
        <i class="ti ti-device-tv" aria-hidden="true" />
        Display
      </Button>
      <Dropdown.Root
        position="bottom-left"
        width="12rem"
        items={[
          {
            items: [
              {
                icon: "ti ti-trash",
                label: "Remove location",
                variant: "danger",
                action: () => void removeLocation(),
              },
            ],
          },
        ]}
      >
        <Dropdown.Trigger iconOnly label="Location options" size="sm" disabled={removing()} loading={removing()} tooltip="Location options">
          <i class="ti ti-dots" aria-hidden="true" />
        </Dropdown.Trigger>
      </Dropdown.Root>
    </div>
  );
}
