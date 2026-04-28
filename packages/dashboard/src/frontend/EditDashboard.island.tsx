import { createSignal, For, Show } from "solid-js";
import { cookies } from "@valentinkolb/stdlib/browser";
import { gradients } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";

/**
 * Lightweight summary the SSR passes per widget — just enough to render a
 * checkbox row in the modal. Title + icon mirror what the user sees on the
 * dashboard.
 */
export type DashboardWidgetSummary = {
  /** Composite "appId/widgetId" — stable, matches what we store in the cookie. */
  key: string;
  title: string;
  icon: string;
};

type Props = {
  /** Widgets the user can see (HTTP 200). Some may currently be cookie-hidden. */
  available: DashboardWidgetSummary[];
  /** Widgets registered but locked out by permission (HTTP 204). */
  inaccessible: DashboardWidgetSummary[];
  initialHidden: string[];
  initialGradient: string;
};

/** Single source of truth for the cookie format. SSR reads this same key. */
export const DASHBOARD_COOKIE = "dashboard_settings";

export type DashboardSettings = {
  hiddenWidgets: string[];
  gradient: string;
};

export default function EditDashboard(props: Props) {
  const open = async () => {
    await prompts.dialog<void>(
      (close) => <EditForm props={props} close={close} />,
      { title: "Edit dashboard", icon: "ti ti-adjustments" },
    );
  };

  return (
    <button type="button" class="btn-input btn-input-sm mx-auto" onClick={open}>
      <i class="ti ti-adjustments" />
      Edit dashboard
    </button>
  );
}

const EditForm = (params: { props: Props; close: (r?: void) => void }) => {
  const { props, close } = params;
  const [hidden, setHidden] = createSignal<string[]>([...props.initialHidden]);
  const [gradient, setGradient] = createSignal<string>(props.initialGradient);

  const toggle = (key: string) => {
    const current = hidden();
    setHidden(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  };

  const save = mutations.create<void, void>({
    mutation: async () => {
      const settings: DashboardSettings = {
        hiddenWidgets: hidden(),
        gradient: gradient(),
      };
      cookies.writeJsonCookie(DASHBOARD_COOKIE, settings);
      // Reload to apply the new settings server-side (gradient + filtering).
      window.location.reload();
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <div class="flex flex-col gap-5 px-1 pb-1">
      {/* Name color */}
      <section class="flex flex-col gap-2">
        <span class="text-[11px] uppercase tracking-wider text-dimmed">Name color</span>
        <div class="flex flex-wrap gap-2">
          <For each={gradients.gradientPresets}>
            {(preset) => (
              <button
                type="button"
                title={preset.label}
                onClick={() => setGradient(preset.id)}
                class={`w-7 h-7 rounded-full transition-all ${
                  gradient() === preset.id
                    ? "ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-zinc-900"
                    : "hover:scale-110"
                }`}
                style={`background:${preset.preview}`}
              />
            )}
          </For>
        </div>
      </section>

      {/* Available widgets — checkboxes */}
      <Show when={props.available.length > 0}>
        <section class="flex flex-col gap-2">
          <span class="text-[11px] uppercase tracking-wider text-dimmed">Widgets</span>
          <ul class="flex flex-col">
            <For each={props.available}>
              {(w) => (
                <li>
                  <label class="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <input
                      type="checkbox"
                      checked={!hidden().includes(w.key)}
                      onChange={() => toggle(w.key)}
                      class="shrink-0"
                    />
                    <i class={`${w.icon} text-dimmed text-sm shrink-0`} />
                    <span class="text-sm text-primary flex-1 min-w-0 truncate">{w.title}</span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      {/* Inaccessible widgets — read-only */}
      <Show when={props.inaccessible.length > 0}>
        <section class="flex flex-col gap-2">
          <span class="text-[11px] uppercase tracking-wider text-dimmed">
            Not available at your access level
          </span>
          <ul class="flex flex-col gap-0.5">
            <For each={props.inaccessible}>
              {(w) => (
                <li class="flex items-center gap-3 py-1 px-2 -mx-2 opacity-60">
                  <i class="ti ti-lock text-dimmed text-xs shrink-0" />
                  <i class={`${w.icon} text-dimmed text-sm shrink-0`} />
                  <span class="text-sm text-secondary truncate">{w.title}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <p class="text-[11px] text-dimmed">
        These settings live in a cookie on this browser only — other devices keep their own preferences.
      </p>

      <div class="flex gap-2 justify-end">
        <button type="button" class="btn-input btn-input-sm" onClick={() => close()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary btn-sm"
          onClick={() => save.mutate()}
          disabled={save.loading()}
        >
          {save.loading() ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
};
