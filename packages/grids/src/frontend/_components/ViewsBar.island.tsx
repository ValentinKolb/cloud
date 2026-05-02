import { For, Show } from "solid-js";
import { prompts, navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { View, ViewConfig } from "../../service";

type Props = {
  tableId: string;
  baseUrl: string;
  /** Views the SSR fetch already filtered to this user's visibility scope. */
  initialViews: View[];
  /** True if the user has table-write — gates "save shared" + edit/delete of shared views. */
  canShare: boolean;
  /** Current user id — used to figure out if a view is the user's own personal view. */
  currentUserId: string;
  /** The current filter+sort URL state — what "Save current as view" captures. */
  currentConfig: ViewConfig;
  /** ID of the view that's currently applied (if any) so we can highlight it. */
  activeViewId: string | null;
};

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
  } catch {}
  return fallback;
};

const buildViewUrl = (baseUrl: string, viewId: string | null, config: ViewConfig): string => {
  const url = new URL(baseUrl, "http://x");
  url.searchParams.delete("filter");
  url.searchParams.delete("sort");
  url.searchParams.delete("cursor");
  if (viewId) url.searchParams.set("view", viewId);
  else url.searchParams.delete("view");
  if (config.filter) url.searchParams.set("filter", JSON.stringify(config.filter));
  if (config.sort && Array.isArray(config.sort) && config.sort.length > 0) {
    url.searchParams.set("sort", JSON.stringify(config.sort));
  }
  return `${url.pathname}${url.search}`;
};

export default function ViewsBar(props: Props) {
  const createMutation = mutations.create<View, { name: string; shared: boolean }>({
    mutation: async (input) => {
      const res = await apiClient.views["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: { name: input.name, config: props.currentConfig, shared: input.shared },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save view"));
      return (await res.json()) as View;
    },
    onSuccess: (view) => navigateTo(buildViewUrl(props.baseUrl, view.id, view.config)),
    onError: (e) => prompts.error(e.message),
  });

  const renameMutation = mutations.create<View, { id: string; name: string }>({
    mutation: async (input) => {
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: input.id },
        json: { name: input.name },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to rename view"));
      return (await res.json()) as View;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const deleteMutation = mutations.create<string, string>({
    mutation: async (viewId) => {
      const res = await apiClient.views[":viewId"].$delete({ param: { viewId } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete view"));
      return viewId;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const handleSave = async () => {
    const result = await prompts.form({
      title: "Save view",
      icon: "ti ti-bookmark-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Open tasks" },
        shared: {
          type: "boolean",
          label: props.canShare
            ? "Share with everyone who can read this table"
            : "Share (requires table-write)",
          default: false,
        },
      },
      confirmText: "Save",
    });
    if (!result) return;
    if (result.shared && !props.canShare) {
      prompts.error("You don't have permission to share views on this table.");
      return;
    }
    createMutation.mutate({ name: String(result.name).trim(), shared: Boolean(result.shared) });
  };

  const canEditView = (view: View): boolean => {
    if (view.ownerUserId === props.currentUserId) return true;
    if (view.ownerUserId === null && props.canShare) return true;
    return false;
  };

  const handleRename = async (view: View) => {
    const result = await prompts.form({
      title: "Rename view",
      icon: "ti ti-edit",
      fields: { name: { type: "text", label: "Name", required: true, default: view.name } },
      confirmText: "Save",
    });
    if (!result) return;
    const next = String(result.name).trim();
    if (next === view.name) return;
    renameMutation.mutate({ id: view.id, name: next });
  };

  const handleDelete = async (view: View) => {
    const confirmed = await prompts.confirm(
      `Delete view "${view.name}"? Records remain — only the saved filter/sort goes away.`,
      { title: "Delete view?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMutation.mutate(view.id);
  };

  const isAllPills = props.activeViewId === null;
  const dirtyVsActive = props.activeViewId !== null
    && props.initialViews.find((v) => v.id === props.activeViewId)?.config &&
       JSON.stringify(props.currentConfig) !== JSON.stringify(props.initialViews.find((v) => v.id === props.activeViewId)!.config);

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      {/* "All records" pill — clears any view + filter selection. */}
      <a
        href={buildViewUrl(props.baseUrl, null, {})}
        class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
          isAllPills
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-primary dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        }`}
      >
        <i class="ti ti-list text-xs" /> All
      </a>

      <For each={props.initialViews}>
        {(view) => {
          const active = view.id === props.activeViewId;
          const editable = canEditView(view);
          return (
            <span class="group inline-flex items-center gap-0.5">
              <a
                href={buildViewUrl(props.baseUrl, view.id, view.config)}
                class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-primary dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }`}
              >
                <i
                  class={`text-xs ${view.ownerUserId === null ? "ti ti-users" : "ti ti-user"}`}
                  title={view.ownerUserId === null ? "Shared view" : "Personal view"}
                />
                {view.name}
              </a>
              <Show when={editable}>
                <button
                  type="button"
                  class="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-dimmed hover:text-primary px-0.5"
                  onClick={() => handleRename(view)}
                  title="Rename view"
                >
                  <i class="ti ti-edit" />
                </button>
                <button
                  type="button"
                  class="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-dimmed hover:text-red-500 px-0.5"
                  onClick={() => handleDelete(view)}
                  title="Delete view"
                >
                  <i class="ti ti-trash" />
                </button>
              </Show>
            </span>
          );
        }}
      </For>

      <button
        type="button"
        class="btn-simple btn-sm text-[11px] text-dimmed ml-1"
        onClick={handleSave}
        disabled={createMutation.loading()}
        title={dirtyVsActive ? "Save current filter/sort as a new view" : "Save view"}
      >
        <i class="ti ti-bookmark-plus" />
        {dirtyVsActive ? " Save changes" : " Save view"}
      </button>
    </div>
  );
}
