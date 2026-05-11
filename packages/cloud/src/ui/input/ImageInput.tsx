import { showFileDialog } from "@valentinkolb/stdlib/browser";
import { img } from "@valentinkolb/stdlib/browser";
import { Show } from "solid-js";
import { InputWrapper, createInputA11y } from "./util";

type ImageInputProps = {
  label?: string;
  description?: string;
  ariaLabel?: string;
  value?: () => string | null;
  round?: boolean;
  variant?: "default" | "small";
  onChange?: (value: string | null) => void;
  error?: () => string | undefined;
  required?: boolean;
  disabled?: boolean;
  /**
   * Custom file→data-URL transform applied to the picked file before
   * emitting via `onChange`. Default = `img.presets.avatar` which
   * produces a 512×512 cropped WebP — fine for square avatars but
   * the wrong shape for banners / title images. Pass a custom
   * transform (e.g. one that preserves aspect ratio and caps the
   * longest side) to override. Receives the user-picked `File`,
   * returns a base64 data-URL string.
   */
  transform?: (file: File) => Promise<string>;
  /**
   * File-picker `accept` attribute. Default matches the common
   * raster formats the avatar preset handles. Override when a
   * caller needs to allow / restrict different formats.
   */
  accept?: string;
};

/**
 * Image input component with file upload and preview
 * @param label - Optional label text
 * @param description - Optional description text
 * @param ariaLabel - Accessibility label (defaults to label if not provided)
 * @param value - Reactive string value getter (base64 or URL, fallback URLs are treated as null)
 * @param onChange - Called when image changes (receives base64 string or null)
 * @param error - Reactive error message getter
 * @param round - Display image in circular shape
 * @param variant - "default" for large preview, "small" for inline compact view
 * @param required - Show required asterisk after label
 * @param disabled - Disable the input
 */
const ImageInput = (props: ImageInputProps) => {
  const disabled = () => (props.disabled ?? false) || !props.onChange;
  const variant = () => props.variant ?? "default";
  const a11y = createInputA11y({ description: props.description, error: props.error });

  // Effective value: treat fallback URLs as null (no custom image set)
  const value = () => {
    const val = props.value?.();
    return val && !val.includes("?fallback") ? val : null;
  };

  const selectImage = () => {
    if (disabled()) return;
    const transform = props.transform ?? ((f: File) => img.presets.avatar(f));
    showFileDialog({ accept: props.accept ?? ".jpg,.jpeg,.png,.gif,.webp" })
      .then(transform)
      .then((image) => props.onChange?.(image));
  };

  // Small variant - inline compact view (same height as text input)
  if (variant() === "small") {
    return (
      <InputWrapper
        label={props.label}
        description={props.description}
        error={props.error?.()}
        required={props.required}
        inputId={a11y.inputId}
        descriptionId={a11y.descriptionId}
        errorId={a11y.errorId}
      >
        <div class="flex h-9 items-center gap-1" role="group" aria-labelledby={a11y.inputId} aria-describedby={a11y.ariaDescribedBy()}>
            <button
              type="button"
              class={`btn-secondary btn-sm h-9 w-9 shrink-0 overflow-hidden !p-0 ${props.round ? "rounded-full" : "rounded-lg"}`}
              disabled
              aria-hidden="true"
              tabIndex={-1}
            >
              <Show
                when={value()}
                fallback={
                  <div class="flex h-full w-full items-center justify-center">
                    <i class="ti ti-photo-off opacity-65" aria-hidden="true" />
                  </div>
                }
              >
                <img src={value()!} alt={props.label || "Selected image"} class="h-full w-full object-cover" />
              </Show>
            </button>
            <button
              type="button"
              class="btn-secondary btn-sm flex h-9 w-9 items-center justify-center"
              onClick={selectImage}
              aria-label={value() ? "Change image" : "Add image"}
              disabled={disabled()}
            >
              <i class={value() ? "ti ti-edit" : "ti ti-photo-plus"} aria-hidden="true" />
            </button>
            <Show when={value()}>
              <button
                type="button"
                class="btn-secondary btn-sm flex h-9 w-9 items-center justify-center"
                onClick={() => props.onChange?.(null)}
                aria-label="Remove image"
                disabled={disabled()}
              >
                <i class="ti ti-trash" aria-hidden="true" />
              </button>
            </Show>
        </div>
      </InputWrapper>
    );
  }

  // Default variant - large preview
  return (
    <InputWrapper
      label={props.label}
      description={props.description}
      error={props.error?.()}
      required={props.required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <div class="flex flex-col items-center gap-1" role="group" aria-labelledby={a11y.inputId} aria-describedby={a11y.ariaDescribedBy()}>
          <div
            class={`h-30 w-30 self-center overflow-hidden border-2 border-zinc-200 md:h-50 md:w-50 dark:border-zinc-700 ${
              props.round ? "rounded-full" : "rounded-2xl"
            }`}
          >
            <Show
              when={value()}
              fallback={
                <div class="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                  <i class="ti ti-photo-off text-2xl text-zinc-400 dark:text-zinc-600" aria-hidden="true" />
                </div>
              }
            >
              <img
                src={value()!}
                alt={props.label || "Selected image"}
                class="h-full w-full object-cover"
                aria-label={props.ariaLabel || props.label || "Selected image"}
              />
            </Show>
          </div>

          <div class="mb-4 flex flex-row items-center gap-2 self-center">
            <Show when={value()}>
              <button
                type="button"
                class="btn-simple btn-sm"
                onClick={() => props.onChange?.(null)}
                aria-label="Remove image"
                disabled={disabled()}
              >
                <i class="ti ti-trash" aria-hidden="true" />
                Remove
              </button>
            </Show>

            <button
              type="button"
              class="btn-simple btn-sm"
              onClick={selectImage}
              aria-label={value() ? "Change image" : "Add image"}
              disabled={disabled()}
            >
              <i class="ti ti-photo-plus" aria-hidden="true" />
              {value() ? "Change" : "Add"}
            </button>
          </div>
      </div>
    </InputWrapper>
  );
};

export default ImageInput;
