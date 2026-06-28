import { Show, type JSX } from "solid-js";

/**
 * Shared building blocks for admin "Settings" forms — extracted from
 * FilesSettingsForm / WeatherSettingsForm / CoreSettingsForm which all
 * implement the same change-tracking + sticky-save-bar UX.
 *
 * NOT an island. Subcomponents are pulled into the consuming `*.island.tsx`
 * file at compile time, so the island boundary stays at the form level (the
 * SSR plugin discovers islands by `.island.tsx` suffix).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Stable JSON-based equality check. Used to detect "did this setting value
 * change vs. its initial state?" — works for primitives, arrays, plain objects.
 * Order-sensitive for arrays/object keys; that's intentional for settings
 * where order matters (string_list, number_list).
 */
export const sameSettingValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Parses a settings-API error response into a user-message + per-field error
 * map. Mirrors the shape every settings PUT endpoint returns.
 */
export const readSettingsError = async (
  response: Response,
  fallback: string,
): Promise<{ message: string; fields: Record<string, string> }> => {
  const data = (await response.json().catch(() => null)) as { message?: string; errors?: Record<string, string> } | null;
  return {
    message: data?.message ?? fallback,
    fields: data?.errors ?? {},
  };
};

// ── Field row ────────────────────────────────────────────────────────────────

export type SettingsFieldProps = {
  label: string;
  description: string;
  /** Reactive accessor for the per-field error string (undefined = no error). */
  error: () => string | undefined;
  /** Reactive accessor for "is this field's value different from its initial?". */
  changed?: () => boolean;
  /** The actual input control (TextInput, NumberInput, Switch, etc.). */
  children: JSX.Element;
};

/**
 * Single-row field wrapper for settings forms.
 *
 * Renders label + description on top, the input below, an inline error message
 * underneath, and a soft amber background + a small dot when the value has
 * unsaved changes. Mirrors the per-row UX of `/admin/settings`.
 *
 * Uses a `<div>` (not a `<label>`) — the actual `<input>` inside `children`
 * has its own a11y attributes; this is purely a visual heading.
 */
export function SettingsField(props: SettingsFieldProps) {
  return (
    <div class="flex flex-col gap-1.5 px-3 py-3" classList={{ "bg-amber-50/50 dark:bg-amber-950/20": props.changed?.() ?? false }}>
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <div class="text-sm font-medium text-primary">{props.label}</div>
          <Show when={props.changed?.()}>
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved change" />
          </Show>
        </div>
        <p class="text-xs text-dimmed">{props.description}</p>
      </div>
      {props.children}
      <Show when={props.error()}>
        <p class="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
          <i class="ti ti-alert-circle text-xs" /> {props.error()}
        </p>
      </Show>
    </div>
  );
}

// ── Sticky save bar ─────────────────────────────────────────────────────────

export type SettingsSaveBarProps = {
  /** Number of unsaved changes — when 0 the bar hides. */
  changeCount: () => number;
  /** Mutation loading flag — disables both buttons + flips Save → Saving. */
  loading: () => boolean;
  /** Reset all unsaved changes back to the initial values. */
  onDiscard: () => void;
  /** Trigger the bulk PUT save. */
  onSave: () => void;
};

/**
 * Sticky bottom bar shown when at least one field has unsaved changes.
 * Displays "<n> unsaved change(s)" + Discard + Save buttons. Identical UX
 * across files/weather/core settings forms.
 */
export function SettingsSaveBar(props: SettingsSaveBarProps) {
  return (
    <Show when={props.changeCount() > 0}>
      <div class="sticky bottom-0 z-10 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 flex items-center justify-between gap-3">
        <p class="text-xs text-dimmed">
          <span class="font-medium text-primary">{props.changeCount()}</span> unsaved change{props.changeCount() > 1 ? "s" : ""}
        </p>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-secondary btn-sm" onClick={props.onDiscard} disabled={props.loading()}>
            Discard
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={props.onSave} disabled={props.loading()}>
            <Show
              when={props.loading()}
              fallback={
                <>
                  <i class="ti ti-device-floppy text-xs" /> Save all
                </>
              }
            >
              <i class="ti ti-loader-2 animate-spin text-xs" /> Saving...
            </Show>
          </button>
        </div>
      </div>
    </Show>
  );
}
