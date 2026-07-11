import { prompts, SegmentedControl, toast } from "@valentinkolb/cloud/ui";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { createSignal } from "solid-js";

export type PublicDashboardDisplayTheme = "light" | "dark";
export type PublicDashboardDisplayHeight = "scroll" | "full";

type PublicDashboardDisplayOptions = {
  theme?: PublicDashboardDisplayTheme;
  height?: PublicDashboardDisplayHeight;
};

type OpenPublicDashboardDisplayDialogOptions = {
  resolveLink: (options: PublicDashboardDisplayOptions) => Promise<string>;
};

export const openPublicDashboardDisplayDialog = async (options: OpenPublicDashboardDisplayDialogOptions) => {
  try {
    await prompts.dialog<void>(
      (close) => {
        const [theme, setTheme] = createSignal<PublicDashboardDisplayTheme>("dark");
        const [height, setHeight] = createSignal<PublicDashboardDisplayHeight>("scroll");
        const [busy, setBusy] = createSignal<"copy" | "open" | null>(null);

        const resolveLink = () => options.resolveLink({ theme: theme(), height: height() });

        const copyLink = async () => {
          setBusy("copy");
          try {
            await clipboard.copy(await resolveLink());
            toast.success("Public display link copied");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not copy public display link");
          } finally {
            setBusy(null);
          }
        };

        const openLink = async () => {
          setBusy("open");
          try {
            window.open(await resolveLink(), "_blank", "noopener,noreferrer");
            close();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not open public display");
          } finally {
            setBusy(null);
          }
        };

        return (
          <div class="flex w-full min-w-0 max-w-xl flex-col gap-4 overflow-hidden">
            <p class="max-w-full text-sm leading-relaxed text-dimmed">Choose a display URL for monitors, shared links, or embedded screens.</p>

            <div class="flex min-w-0 flex-col gap-2">
              <p class="text-sm font-medium text-primary">Theme</p>
              <SegmentedControl<PublicDashboardDisplayTheme>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light", label: "Light", icon: "ti ti-sun" },
                  { value: "dark", label: "Dark", icon: "ti ti-moon" },
                ]}
              />
            </div>

            <div class="flex min-w-0 flex-col gap-2">
              <p class="text-sm font-medium text-primary">Page height</p>
              <SegmentedControl<PublicDashboardDisplayHeight>
                value={height}
                onChange={setHeight}
                options={[
                  { value: "scroll", label: "Scrollable", icon: "ti ti-arrows-vertical" },
                  { value: "full", label: "Full height", icon: "ti ti-device-tv" },
                ]}
              />
              <p class="text-xs leading-relaxed text-dimmed">
                Full height disables page scrolling for display monitors. Use it only when the dashboard fits the screen.
              </p>
            </div>

            <div class="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" class="btn-input btn-input-sm" disabled={busy() !== null} onClick={copyLink}>
                <i class={`ti ${busy() === "copy" ? "ti-loader-2 animate-spin" : "ti-copy"}`} />
                Copy link
              </button>
              <button type="button" class="btn-input btn-input-sm" disabled={busy() !== null} onClick={openLink}>
                <i class={`ti ${busy() === "open" ? "ti-loader-2 animate-spin" : "ti-external-link"}`} />
                Open display
              </button>
            </div>
          </div>
        );
      },
      { title: "Public display", icon: "ti ti-device-tv" },
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open public display options");
  }
};
