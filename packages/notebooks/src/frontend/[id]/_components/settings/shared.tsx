import { Show } from "solid-js";

export function LocalSaveStrip(props: { dirty: boolean; loading: boolean; label?: string; onSave: () => void }) {
  return (
    <Show
      when={props.dirty}
      fallback={
        <p class="flex items-center gap-1.5 text-xs text-dimmed">
          <i class="ti ti-check text-emerald-500" />
          Saved
        </p>
      }
    >
      <div class="paper flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-200">
        <span class="flex items-center gap-1.5">
          <i class="ti ti-pencil" />
          Unsaved changes
        </span>
        <button type="button" class="btn-primary btn-sm ml-auto" disabled={props.loading} onClick={props.onSave}>
          {props.loading ? (
            <>
              <i class="ti ti-loader-2 animate-spin" />
              Saving
            </>
          ) : (
            (props.label ?? "Save")
          )}
        </button>
      </div>
    </Show>
  );
}

export const settingsChoiceClass = (active: boolean) =>
  `paper relative rounded-lg p-4 text-left transition-[background-color,box-shadow,color] ${
    active
      ? "text-blue-700 dark:text-blue-300 before:absolute before:left-2 before:top-4 before:h-3.5 before:w-0.5 before:rounded-full before:bg-blue-500 dark:before:bg-blue-400"
      : "text-secondary"
  }`;

export function SaveStatus(props: { loading: boolean; saved: boolean; error?: string | null }) {
  if (props.loading) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-dimmed">
        <i class="ti ti-loader-2 animate-spin" />
        Saving...
      </span>
    );
  }
  if (props.error) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
        <i class="ti ti-alert-circle" />
        Failed
      </span>
    );
  }
  if (props.saved) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <i class="ti ti-check" />
        Saved
      </span>
    );
  }
  return null;
}
