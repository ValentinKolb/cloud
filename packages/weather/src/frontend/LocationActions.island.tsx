import { Dropdown, prompts, SegmentedControl, toast } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation } from "@valentinkolb/stdlib/solid";
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
          onChange={setZoom}
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
          onChange={setTheme}
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
          onChange={setView}
          options={[
            { value: "simple", label: "Simple", icon: "ti ti-layout-bottombar" },
            { value: "detail", label: "Detailed", icon: "ti ti-layout-grid" },
          ]}
        />
      </div>

      <button type="submit" class="btn-secondary btn-md mt-4 self-end">
        <i class="ti ti-external-link" aria-hidden="true" />
        Open display
      </button>
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
      <button type="button" onClick={openDisplay} class="btn-secondary btn-sm">
        <i class="ti ti-device-tv" aria-hidden="true" />
        Display
      </button>
      <Dropdown
        trigger={
          <button type="button" class="icon-btn h-8 w-8" aria-label="Location options" disabled={remove.loading()}>
            <i class={remove.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-dots"} aria-hidden="true" />
          </button>
        }
        position="bottom-left"
        width="w-48"
        elements={[
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
      />
    </div>
  );
}
