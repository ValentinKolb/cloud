import { createSignal, Show } from "solid-js";
import { dialogCore } from "../dialog-core";
import FileDropzone from "../input/FileDropzone";
import Avatar from "./Avatar";
import { createAvatarDataUrlFromFile } from "./avatar-upload";
import PanelDialog, { panelDialogOptions } from "./PanelDialog";

const avatarUploadDialogOptions = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(94vw,34rem)]"),
};

export type AvatarUploadDialogOptions = {
  username: string;
  userId?: string | null;
  avatarHash?: string | null;
  title?: string;
  subtitle?: string;
  visibilityText?: string;
  saveLabel?: string;
  onSave: (dataUrl: string) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
};

const avatarErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "Failed to process avatar image.";
  if (error.message.includes("could not be compressed")) {
    return "This image could not be prepared as a small avatar. Try a simpler image.";
  }
  return error.message;
};

function AvatarUploadDialog(props: AvatarUploadDialogOptions & { close: (saved?: boolean) => void }) {
  const [dataUrl, setDataUrl] = createSignal<string | null>(null);
  const [processing, setProcessing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [removing, setRemoving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const busy = () => processing() || saving() || removing();

  const handleFiles = async (files: File[]) => {
    const file = files[0];
    if (!file || busy()) return;
    setProcessing(true);
    setError(null);
    try {
      setDataUrl(await createAvatarDataUrlFromFile(file));
    } catch (err) {
      setDataUrl(null);
      setError(avatarErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    const nextAvatar = dataUrl();
    if (!nextAvatar || busy()) return;
    setSaving(true);
    setError(null);
    try {
      await props.onSave(nextAvatar);
      props.close(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save avatar.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!props.avatarHash || !props.onRemove || busy()) return;
    setRemoving(true);
    setError(null);
    try {
      await props.onRemove();
      props.close(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove avatar.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.title ?? "Change Avatar"}
        subtitle={props.subtitle ?? "Choose a profile picture and review it before saving."}
        icon="ti ti-user-circle"
        close={() => props.close(false)}
      />
      <PanelDialog.Body>
        <div class="flex flex-col items-center gap-4 px-5 py-6">
          <Show
            when={dataUrl()}
            fallback={
              <Avatar
                username={props.username}
                userId={props.userId}
                avatarHash={props.avatarHash}
                size="xl"
                class="h-28 w-28 rounded-full text-2xl shadow-[var(--theme-shadow-elevated)]"
              />
            }
          >
            <img
              src={dataUrl()!}
              alt={`${props.username} avatar preview`}
              class="h-28 w-28 rounded-full object-cover shadow-[var(--theme-shadow-elevated)]"
            />
          </Show>
          <p class="max-w-md text-center text-xs text-dimmed">
            {props.visibilityText ?? "Profile pictures are visible to all account holders."}
          </p>
          <div class="w-full max-w-xl">
            <FileDropzone
              accept="image/png,image/jpeg,image/webp"
              multiple={false}
              disabled={saving() || removing()}
              busy={processing}
              error={error}
              icon="ti-photo-plus"
              title={dataUrl() ? "Drop another image or click to replace" : "Drop image or click to choose"}
              subtitle="PNG, JPEG, or WebP"
              hint="Cropped square and compressed before saving."
              onDrop={handleFiles}
            />
          </div>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div class="min-w-0">
          <Show when={props.avatarHash && props.onRemove}>
            <button type="button" class="btn-secondary btn-sm" onClick={handleRemove} disabled={busy()} aria-label="Remove current avatar">
              <i class="ti ti-user-x" aria-hidden="true" />
              {removing() ? "Removing..." : "Remove Avatar"}
            </button>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(false)} disabled={saving() || removing()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={handleSave} disabled={!dataUrl() || busy()}>
            {saving() ? "Saving..." : (props.saveLabel ?? "Save Avatar")}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openAvatarUploadDialog = (options: AvatarUploadDialogOptions): Promise<boolean> =>
  dialogCore
    .open<boolean>((close) => <AvatarUploadDialog {...options} close={(saved) => close(Boolean(saved))} />, avatarUploadDialogOptions)
    .then(Boolean);
