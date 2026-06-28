import { createMemo, createSignal, For, Show } from "solid-js";
import { AppOverview, ColorInput, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Space } from "@/contracts";
import { setLastSpaceId } from "./[id]/_components/settings/SpaceSettingsStore";

type Props = {
  spaces: Space[];
  initialQuery: string;
};

type SpaceStarter = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
};

type SpaceDraft = {
  name: string;
  description: string;
  color: string;
};

const starters: SpaceStarter[] = [
  {
    id: "tasks",
    name: "Task board",
    description: "Plan work with lists, kanban, deadlines, and assignees.",
    icon: "ti ti-list-check",
    color: "#3b82f6",
  },
  {
    id: "calendar",
    name: "Event calendar",
    description: "Coordinate dated events, all-day work, and schedules.",
    icon: "ti ti-calendar-event",
    color: "#8b5cf6",
  },
  {
    id: "project",
    name: "Project tracker",
    description: "Track delivery across statuses, owners, and priorities.",
    icon: "ti ti-flag",
    color: "#10b981",
  },
];

const blankStarter: SpaceStarter = {
  id: "blank",
  name: "Blank space",
  description: "Create an empty space with the default workflow columns.",
  icon: "ti ti-plus",
  color: "#3b82f6",
};

const spaceMatches = (space: Space, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${space.name} ${space.description ?? ""} ${space.id}`.toLowerCase().includes(q);
};

const setQueryParam = (value: string) => {
  const url = new URL(window.location.href);
  const trimmed = value.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  else url.searchParams.delete("q");
  window.history.replaceState({}, "", url.toString());
};

const errorMessage = async (res: Response, fallback: string) => {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  } catch {
    // Keep fallback.
  }
  return fallback;
};

function CreateSpaceForm(props: { starter: SpaceStarter; close: (result: SpaceDraft | null) => void }) {
  const [name, setName] = createSignal(props.starter.id === "blank" ? "" : props.starter.name);
  const [description, setDescription] = createSignal(props.starter.id === "blank" ? "" : props.starter.description);
  const [color, setColor] = createSignal(props.starter.color);
  const [error, setError] = createSignal("");

  const submit = (event: Event) => {
    event.preventDefault();
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    props.close({ name: trimmedName, description: description().trim(), color: color() });
  };

  return (
    <form onSubmit={submit} class="flex flex-col gap-4">
      <div class="info-block-info">You are automatically the admin of this space. Access can be changed later in settings.</div>
      <TextInput
        label="Name"
        description="A short name for this workspace"
        placeholder={props.starter.name}
        icon="ti ti-typography"
        value={name}
        onInput={(value) => {
          setName(value);
          setError("");
        }}
        required
      />
      <TextInput
        label="Description"
        description="Optional context shown on the space overview"
        placeholder={props.starter.description}
        icon="ti ti-align-left"
        value={description}
        onInput={setDescription}
        multiline
        lines={3}
      />
      <ColorInput label="Color" description="Used for cards, calendars, and visual identification" value={color} onChange={setColor} />
      <Show when={error()}>
        <p class="flex items-center gap-1 text-sm text-red-500">
          <i class="ti ti-alert-circle" />
          {error()}
        </p>
      </Show>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(null)}>
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm">
          Create
        </button>
      </div>
    </form>
  );
}

export default function SpacesOverview(props: Props) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const filteredSpaces = createMemo(() => props.spaces.filter((space) => spaceMatches(space, query())));

  const createSpaceMutation = mutations.create<Space | null, SpaceStarter>({
    mutation: async (starter) => {
      const result = await prompts.dialog<SpaceDraft | null>((close) => <CreateSpaceForm starter={starter} close={close} />, {
        title: starter.id === "blank" ? "New space" : starter.name,
        icon: starter.icon,
      });
      if (!result) return null;

      const res = await apiClient.index.$post({
        json: {
          name: result.name,
          description: result.description || undefined,
          color: result.color,
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create space"));
      return res.json();
    },
    onSuccess: (space) => {
      if (!space) return;
      toast.success("Space created");
      setLastSpaceId(space.id);
      navigateTo(`/app/spaces/${space.id}`);
    },
    onError: (error) => prompts.error(error.message),
  });

  const onSearchInput = (value: string) => {
    setQuery(value);
    setQueryParam(value);
  };

  return (
    <AppOverview title="Spaces" subtitle="Organize tasks, events, calendars, and lightweight project workflows." icon="ti ti-layout-kanban">
      <AppOverview.Main
        title="Your spaces"
        description={
          props.spaces.length === 0
            ? "Start from a starter, or create a blank space."
            : `${props.spaces.length} space${props.spaces.length === 1 ? "" : "s"} available`
        }
        toolbar={
          <TextInput
            name="spaces-search"
            type="search"
            ariaLabel="Search spaces"
            placeholder="Search spaces..."
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={query}
            onInput={onSearchInput}
            clearable
            onClear={() => onSearchInput("")}
          />
        }
      >
        <Show
          when={props.spaces.length > 0}
          fallback={
            <AppOverview.EmptyState title="No spaces yet" icon="ti ti-layout-kanban" class="min-h-72">
              <p class="max-w-sm text-xs text-dimmed">
                Starters create a focused space shell; columns, tags, permissions, and calendar settings can be adjusted later.
              </p>
            </AppOverview.EmptyState>
          }
        >
          <Show
            when={filteredSpaces().length > 0}
            fallback={<AppOverview.EmptyState title="No matching spaces" description="Try a different search term." icon="ti ti-search" />}
          >
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <For each={filteredSpaces()}>
                {(space) => (
                  <a
                    href={`/app/spaces/${space.id}`}
                    class="paper flex items-center gap-4 p-4 no-underline transition-all hover:paper-highlighted"
                    style={`view-transition-name: space-card-${space.id}`}
                  >
                    <div
                      class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center text-white"
                      style={`background-color: ${space.color}; view-transition-name: space-color-${space.id}`}
                    >
                      <i class="ti ti-layout-kanban text-lg" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <span
                        class="block truncate text-sm font-semibold text-primary"
                        style={`view-transition-name: space-name-${space.id}`}
                      >
                        {space.name}
                      </span>
                      <p class="truncate text-xs text-dimmed">{space.description || "No description"}</p>
                    </div>
                    <i class="ti ti-chevron-right text-dimmed" />
                  </a>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </AppOverview.Main>

      <AppOverview.Aside title="Create" description="Choose a starter, or start blank.">
        <div class="grid grid-cols-1 gap-2">
          <For each={starters}>
            {(starter) => (
              <button
                type="button"
                class="paper flex items-start gap-3 p-4 text-left transition-all hover:paper-highlighted"
                onClick={() => createSpaceMutation.mutate(starter)}
                disabled={createSpaceMutation.loading()}
              >
                <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                  <i class={`${starter.icon} text-lg text-primary`} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold text-primary">{starter.name}</span>
                  <span class="line-clamp-2 block text-xs leading-snug text-dimmed">{starter.description}</span>
                </span>
              </button>
            )}
          </For>

          <button
            type="button"
            class="paper flex items-start gap-3 p-4 text-left transition-all hover:paper-highlighted"
            onClick={() => createSpaceMutation.mutate(blankStarter)}
            disabled={createSpaceMutation.loading()}
          >
            <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-blue-100 dark:bg-blue-900/50">
              <i class="ti ti-plus text-lg text-blue-600 dark:text-blue-400" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-primary">Blank space</span>
              <span class="block text-xs leading-snug text-dimmed">Create an empty space with the default workflow columns.</span>
            </span>
          </button>
        </div>
      </AppOverview.Aside>
    </AppOverview>
  );
}
