import { refreshCurrentPath } from "@k2b/ssr/nav";
import { IconButton } from "@k2b/ui";
import { createSignal } from "solid-js";
import { openBookSettingsDialog } from "./BookSettingsDialog";

export default function BookSettingsButton(props: { bookId: string; bookName: string }) {
  const [open, setOpen] = createSignal(false);

  const openSettings = async () => {
    if (open()) return;
    setOpen(true);
    try {
      const result = await openBookSettingsDialog({ bookId: props.bookId });
      if (result.workspaceChanged && !result.deleted) refreshCurrentPath();
    } finally {
      setOpen(false);
    }
  };

  return (
    <IconButton
      size="xs"
      variant="ghost"
      label={`Open settings for ${props.bookName}`}
      disabled={open()}
      onClick={() => void openSettings()}
    >
      <i class={open() ? "ti ti-loader-2 animate-spin" : "ti ti-settings"} aria-hidden="true" />
    </IconButton>
  );
}
