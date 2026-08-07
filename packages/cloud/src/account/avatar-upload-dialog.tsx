import { Button, dialogCore, FileDropzone, ImageCropper, type ImageCropState, PanelDialog, panelDialogOptions } from "@k2b/ui";
import { createSignal, Show } from "solid-js";
import { CloudAvatar } from "./Avatar";
import { createAvatarDataUrlFromFile, validateAvatarSourceFile } from "./avatar-upload";

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
  const [sourceFile, setSourceFile] = createSignal<File | null>(null);
  const [cropState, setCropState] = createSignal<ImageCropState | null>(null);
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
      validateAvatarSourceFile(file);
      setSourceFile(file);
      setCropState(null);
    } catch (err) {
      setSourceFile(null);
      setCropState(null);
      setError(avatarErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    const file = sourceFile();
    const crop = cropState();
    if (!file || !crop || busy()) return;
    setSaving(true);
    setError(null);
    try {
      const nextAvatar = await createAvatarDataUrlFromFile(file, crop);
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
            when={sourceFile()}
            fallback={
              <CloudAvatar
                username={props.username}
                userId={props.userId}
                avatarHash={props.avatarHash}
                size="xl"
                class="h-28 w-28 rounded-full text-2xl shadow-[var(--ui-shadow-surface)]"
              />
            }
          >
            <div class="w-full max-w-md">
              <ImageCropper
                source={sourceFile()!}
                aspect={{ width: 1, height: 1 }}
                previewShape="circle"
                disabled={busy()}
                onValueChange={setCropState}
              />
            </div>
          </Show>
          <p class="max-w-md text-center text-xs text-dimmed">
            {props.visibilityText ?? "Profile pictures are visible to all account holders."}
          </p>
          <div class="w-full max-w-xl">
            <FileDropzone
              accept="image/png,image/jpeg,image/webp"
              multiple={false}
              disabled={saving() || removing()}
              busy={processing()}
              error={error}
              icon="ti-photo-plus"
              title={sourceFile() ? "Drop another image or click to replace" : "Drop image or click to choose"}
              subtitle="PNG, JPEG, or WebP"
              hint="Adjust the crop, then save."
              onDrop={handleFiles}
            />
          </div>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div class="min-w-0">
          <Show when={props.avatarHash && props.onRemove}>
            <Button type="button" variant="secondary" size="sm" onClick={handleRemove} disabled={busy()} aria-label="Remove current avatar">
              <i class="ti ti-user-x" aria-hidden="true" />
              {removing() ? "Removing..." : "Remove Avatar"}
            </Button>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => props.close(false)} disabled={saving() || removing()}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={!sourceFile() || !cropState() || busy()}>
            {saving() ? "Saving..." : (props.saveLabel ?? "Save Avatar")}
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openAvatarUploadDialog = (options: AvatarUploadDialogOptions): Promise<boolean> =>
  dialogCore
    .open<boolean>((close) => <AvatarUploadDialog {...options} close={(saved) => close(Boolean(saved))} />, panelDialogOptions)
    .then(Boolean);
