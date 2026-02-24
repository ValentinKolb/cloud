import { For } from "solid-js";
import { type ViewType } from "../settings/SpaceSettingsStore";

type ViewOption = {
  id: ViewType;
  label: string;
  icon: string;
};

const views: ViewOption[] = [
  { id: "list", label: "List", icon: "ti-list-check" },
  { id: "kanban", label: "Kanban", icon: "ti-layout-kanban" },
  { id: "calendar", label: "Calendar", icon: "ti-calendar" },
];

type Props = {
  spaceId: string;
  currentView: ViewType;
  variant: "chip" | "sidebar";
};

/**
 * View switcher component - sets query param to override default view
 */
export default function ViewSwitcher(props: Props) {
  const handleClick = (view: ViewType) => {
    if (view !== props.currentView) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", view);
      window.location.href = url.toString();
    }
  };

  if (props.variant === "chip") {
    return (
      <For each={views}>
        {(view) => (
          <button
            type="button"
            onClick={() => handleClick(view.id)}
            class={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
              props.currentView === view.id
                ? "bg-blue-500 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-secondary hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            <i class={`ti ${view.icon}`} />
            {view.label}
          </button>
        )}
      </For>
    );
  }

  return (
    <For each={views}>
      {(view) => (
        <button
          type="button"
          onClick={() => handleClick(view.id)}
          class={`list-item text-xs ${props.currentView === view.id ? "list-item-active" : ""}`}
        >
          <i class={`ti ${view.icon} text-sm`} />
          <span>{view.label}</span>
        </button>
      )}
    </For>
  );
}
