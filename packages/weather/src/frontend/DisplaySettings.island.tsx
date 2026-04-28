import { createSignal } from "solid-js";
import { prompts } from "@valentinkolb/cloud/ui";
import { buildDisplayUrl } from "./params";
import { SegmentedControl } from "@valentinkolb/cloud/ui";

type DisplaySettings = {
  zoom: 1 | 2 | 3;
  theme: "light" | "dark";
  detail: boolean;
};

function SettingsForm(props: { location: { lat: number; lon: number }; onSubmit: (settings: DisplaySettings) => void }) {
  const [zoom, setZoom] = createSignal<"1" | "2" | "3">("2");
  const [theme, setTheme] = createSignal<"light" | "dark">("dark");
  const [view, setView] = createSignal<"simple" | "detail">("simple");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    props.onSubmit({
      zoom: parseInt(zoom()) as 1 | 2 | 3,
      theme: theme(),
      detail: view() === "detail",
    });
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">Zoom Level</p>
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
            {
              value: "simple",
              label: "Simple",
              icon: "ti ti-layout-bottombar",
            },
            { value: "detail", label: "Detailed", icon: "ti ti-layout-grid" },
          ]}
        />
      </div>

      <button type="submit" class="btn-secondary btn-md self-end mt-4">
        <i class="ti ti-external-link" />
        Open Link
      </button>
    </form>
  );
}

export default function DisplaySettingsButton(props: { lat: number; lon: number }) {
  const handleClick = () => {
    prompts.dialog(
      (close) => (
        <SettingsForm
          location={{ lat: props.lat, lon: props.lon }}
          onSubmit={(settings) => {
            window.open(buildDisplayUrl(props.lat, props.lon, settings), "_blank");
            close(null);
          }}
        />
      ),
      {
        title: "Display Settings",
        icon: "ti ti-device-tv",
      },
    );
  };

  return (
    <button type="button" onClick={handleClick} class="btn-secondary btn-sm" aria-label="Open fullscreen display">
      <i class="ti ti-device-tv" />
      Fullscreen
    </button>
  );
}
