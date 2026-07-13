import { prompts, SegmentedControl, Switch, toast } from "@valentinkolb/cloud/ui";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { createSignal } from "solid-js";
import { buildPublicVenueUrl, VENUE_PUBLIC_REFRESH_SECONDS, type VenuePublicDisplayHeight } from "../../public-runtime";

export const openVenuePublicDisplayDialog = async (slug: string): Promise<void> => {
  try {
    await prompts.dialog<void>(
      (close) => {
        const [height, setHeight] = createSignal<VenuePublicDisplayHeight>("scroll");
        const [refresh, setRefresh] = createSignal(false);
        const [busy, setBusy] = createSignal<"copy" | "open" | null>(null);
        const resolveLink = () => buildPublicVenueUrl(window.location.origin, slug, { height: height(), refresh: refresh() });
        const setLayout = (value: VenuePublicDisplayHeight) => {
          setHeight(value);
          if (value === "full") setRefresh(true);
        };

        const copyLink = async () => {
          setBusy("copy");
          try {
            await clipboard.copy(resolveLink());
            toast.success("Public page link copied");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not copy public page link");
          } finally {
            setBusy(null);
          }
        };

        const openLink = () => {
          setBusy("open");
          try {
            window.open(resolveLink(), "_blank", "noopener,noreferrer");
            close();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not open public page");
          } finally {
            setBusy(null);
          }
        };

        return (
          <div class="flex w-full min-w-0 max-w-xl flex-col gap-4 overflow-hidden">
            <p class="text-sm leading-relaxed text-dimmed">
              Choose the regular visitor page or a fixed display made for unattended monitors.
            </p>
            <div class="flex min-w-0 flex-col gap-2">
              <p class="text-sm font-medium text-primary">Page layout</p>
              <SegmentedControl<VenuePublicDisplayHeight>
                value={height}
                onChange={setLayout}
                options={[
                  { value: "scroll", label: "Scrollable page", icon: "ti ti-arrows-vertical" },
                  { value: "full", label: "Full display", icon: "ti ti-device-tv" },
                ]}
              />
              <p class="text-xs leading-relaxed text-dimmed">
                Full display never scrolls and replaces interactive feedback with a QR code.
              </p>
            </div>
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-primary">Live updates</p>
                <p class="text-xs leading-relaxed text-dimmed">
                  Refresh venue status and public content in place every {VENUE_PUBLIC_REFRESH_SECONDS} seconds.
                </p>
              </div>
              <Switch label="Auto refresh" value={refresh} onChange={setRefresh} />
            </div>
            <div class="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" class="btn-input btn-input-sm" disabled={busy() !== null} onClick={copyLink}>
                <i class={`ti ${busy() === "copy" ? "ti-loader-2 animate-spin" : "ti-copy"}`} />
                Copy link
              </button>
              <button type="button" class="btn-input btn-input-sm" disabled={busy() !== null} onClick={openLink}>
                <i class={`ti ${busy() === "open" ? "ti-loader-2 animate-spin" : "ti-external-link"}`} />
                Open page
              </button>
            </div>
          </div>
        );
      },
      { title: "Public page", icon: "ti ti-device-tv" },
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open public page options");
  }
};
