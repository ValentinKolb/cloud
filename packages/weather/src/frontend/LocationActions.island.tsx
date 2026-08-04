import { navigateTo } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import { Button, Dropdown, IconButton, prompts, SegmentedControl, Tooltip, toast } from "@k2b/ui";
import { createSignal } from "solid-js";
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
  const remove = mutation.create({
    mutation: async () => {
      const confirmed = await prompts.confirm("Remove this location?", {
        title: "Remove location",
        variant: "danger",
      });
      if (!confirmed) return false;

      const response = await apiClient.locations[":id"].$delete({ param: { id: props.id } });
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
                action: () => void remove.mutate({}),
              },
            ],
          },
        ]}
      >
        <Dropdown.Trigger
          iconOnly
          label="Location options"
          size="sm"
          disabled={remove.loading()}
          loading={remove.loading()}
          tooltip="Location options"
        >
          <i class="ti ti-dots" aria-hidden="true" />
        </Dropdown.Trigger>
      </Dropdown.Root>
    </div>
  );
}
