import { children, createEffect, createMemo, createSignal, For, type JSX, onMount, Show } from "solid-js";

const RESULT_SLOT = Symbol("DockWorkspace.Result");
const PANE_SLOT = Symbol("DockWorkspace.Pane");

const DEFAULT_RESULT_SIZE = 58;
const MIN_RESULT_SIZE = 22;
const MAX_RESULT_SIZE = 82;
const MIN_SECTION_SIZE = 12;

type ResultSlot = {
  readonly kind: typeof RESULT_SLOT;
  title?: string;
  icon?: string;
  children: JSX.Element;
};

type PaneSlot = {
  readonly kind: typeof PANE_SLOT;
  id: string;
  title: string;
  icon?: string;
  section: string;
  children: JSX.Element;
};

type DockSlot = ResultSlot | PaneSlot;

/**
 * @deprecated Use `Panes` for new resizable/tabbed workspaces. DockWorkspace is kept for existing legacy Pulse screens.
 */
export type DockWorkspaceSectionState = {
  id: string;
  size: number;
  paneIds: string[];
  activePaneId: string;
};

/**
 * @deprecated Use `PanesValue` with `Panes` for new workspaces.
 */
export type DockWorkspaceState = {
  resultSize: number;
  sections: DockWorkspaceSectionState[];
};

/**
 * @deprecated Use explicit `Panes.Element` ids for new workspaces.
 */
export type DockWorkspacePaneDescriptor = {
  id: string;
  section?: string | null;
};

/**
 * @deprecated Use `Panes.Root` plus `Panes.Element` for new resizable/tabbed workspaces.
 */
export type DockWorkspaceProps = {
  storageKey?: string;
  initialState?: DockWorkspaceState | null;
  defaultResultSize?: number;
  class?: string;
  children: JSX.Element;
};

/**
 * @deprecated Use a `Panes.Element` for result panes in new workspaces.
 */
export type DockWorkspaceResultProps = {
  title?: string;
  icon?: string;
  children: JSX.Element;
};

/**
 * @deprecated Use `Panes.Element` for new workspace panes.
 */
export type DockWorkspacePaneProps = {
  id: string;
  title: string;
  icon?: string;
  section?: string;
  children: JSX.Element;
};

type DockWorkspaceComponent = ((props: DockWorkspaceProps) => JSX.Element) & {
  Result: (props: DockWorkspaceResultProps) => JSX.Element;
  Pane: (props: DockWorkspacePaneProps) => JSX.Element;
};

const isDockSlot = (value: unknown): value is DockSlot => !!value && typeof value === "object" && "kind" in value;

const collectDockSlots = (value: unknown): DockSlot[] => {
  if (Array.isArray(value)) return value.flatMap(collectDockSlots);
  return isDockSlot(value) ? [value] : [];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeSizes = <T extends { size: number }>(items: T[]): T[] => {
  if (items.length === 0) return items;
  const sanitized = items.map((item) => ({ ...item, size: Number.isFinite(item.size) ? Math.max(0, item.size) : 0 }));
  const total = sanitized.reduce((sum, item) => sum + item.size, 0);
  if (total <= 0) return sanitized.map((item) => ({ ...item, size: 100 / sanitized.length }));
  return sanitized.map((item) => ({ ...item, size: (item.size / total) * 100 }));
};

const defaultState = (panes: DockWorkspacePaneDescriptor[], defaultResultSize: number): DockWorkspaceState => {
  const sections = new Map<string, DockWorkspacePaneDescriptor[]>();
  for (const pane of panes) {
    const key = pane.section?.trim() || "main";
    sections.set(key, [...(sections.get(key) ?? []), pane]);
  }
  const entries = [...sections.entries()];
  return {
    resultSize: clamp(defaultResultSize, MIN_RESULT_SIZE, MAX_RESULT_SIZE),
    sections: entries.map(([id, items]) => ({
      id,
      size: entries.length > 0 ? 100 / entries.length : 100,
      paneIds: items.map((pane) => pane.id),
      activePaneId: items[0]?.id ?? "",
    })),
  };
};

/**
 * @deprecated Use app-owned `PanesValue` normalization/persistence for new workspaces.
 */
export const normalizeDockWorkspaceState = (
  state: DockWorkspaceState | null | undefined,
  panes: DockWorkspacePaneDescriptor[],
  defaultResultSize = DEFAULT_RESULT_SIZE,
): DockWorkspaceState => {
  const fallback = defaultState(panes, defaultResultSize);
  if (!state || !Array.isArray(state.sections)) return fallback;

  const paneById = new Map(panes.map((pane) => [pane.id, pane]));
  const used = new Set<string>();
  const sections: DockWorkspaceSectionState[] = [];

  for (const section of state.sections) {
    if (!section || typeof section.id !== "string" || !Array.isArray(section.paneIds)) continue;
    const paneIds = section.paneIds.filter((id) => paneById.has(id) && !used.has(id));
    for (const id of paneIds) used.add(id);
    if (paneIds.length === 0) continue;
    sections.push({
      id: section.id,
      size: Number.isFinite(section.size) ? section.size : 0,
      paneIds,
      activePaneId: paneIds.includes(section.activePaneId) ? section.activePaneId : paneIds[0]!,
    });
  }

  for (const pane of panes) {
    if (used.has(pane.id)) continue;
    const sectionId = pane.section?.trim() || "main";
    const target = sections.find((section) => section.id === sectionId);
    if (target) {
      target.paneIds.push(pane.id);
      if (!target.activePaneId) target.activePaneId = pane.id;
    } else {
      sections.push({ id: sectionId, size: MIN_SECTION_SIZE, paneIds: [pane.id], activePaneId: pane.id });
    }
  }

  if (sections.length === 0) return fallback;
  return {
    resultSize: clamp(state.resultSize, MIN_RESULT_SIZE, MAX_RESULT_SIZE),
    sections: normalizeSizes(sections),
  };
};

const dockCookieName = (storageKey: string) => `dock_${storageKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * @deprecated DockWorkspace persistence is legacy. Prefer app-owned `PanesValue` persistence for new workspaces.
 */
export const readDockWorkspaceStateCookie = (cookieHeader: string | null | undefined, storageKey: string): DockWorkspaceState | null => {
  if (!cookieHeader) return null;
  const name = dockCookieName(storageKey);
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!encoded) return null;
  try {
    return JSON.parse(decodeURIComponent(encoded)) as DockWorkspaceState;
  } catch {
    return null;
  }
};

const readClientStateCookie = (storageKey: string): DockWorkspaceState | null =>
  typeof document === "undefined" ? null : readDockWorkspaceStateCookie(document.cookie, storageKey);

const writeClientStateCookie = (storageKey: string, state: DockWorkspaceState) => {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${dockCookieName(storageKey)}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`;
};

const iconClass = (icon: string | undefined, fallback: string) => {
  const value = icon?.trim() || fallback;
  return value.startsWith("ti ") ? value : `ti ${value}`;
};

function DockWorkspaceResult(props: DockWorkspaceResultProps): JSX.Element {
  return {
    kind: RESULT_SLOT,
    title: props.title,
    icon: props.icon,
    children: props.children,
  } satisfies ResultSlot as unknown as JSX.Element;
}

function DockWorkspacePane(props: DockWorkspacePaneProps): JSX.Element {
  return {
    kind: PANE_SLOT,
    id: props.id,
    title: props.title,
    icon: props.icon,
    section: props.section ?? "main",
    children: props.children,
  } satisfies PaneSlot as unknown as JSX.Element;
}

const DockWorkspaceRoot = (props: DockWorkspaceProps) => {
  let rootEl: HTMLDivElement | undefined;
  let bottomEl: HTMLDivElement | undefined;
  const [isMounted, setIsMounted] = createSignal(false);
  const resolved = children(() => props.children);
  const slots = createMemo(() => collectDockSlots(resolved.toArray()));
  const result = createMemo(() => slots().find((slot): slot is ResultSlot => slot.kind === RESULT_SLOT) ?? null);
  const panes = createMemo(() => slots().filter((slot): slot is PaneSlot => slot.kind === PANE_SLOT));
  const paneById = createMemo(() => new Map(panes().map((pane) => [pane.id, pane])));
  const [state, setState] = createSignal<DockWorkspaceState>(
    normalizeDockWorkspaceState(props.initialState, panes(), props.defaultResultSize ?? DEFAULT_RESULT_SIZE),
  );

  createEffect(() => {
    setState((current) => normalizeDockWorkspaceState(current, panes(), props.defaultResultSize ?? DEFAULT_RESULT_SIZE));
  });

  onMount(() => {
    const clientState = props.storageKey ? readClientStateCookie(props.storageKey) : null;
    if (clientState) {
      setState(normalizeDockWorkspaceState(clientState, panes(), props.defaultResultSize ?? DEFAULT_RESULT_SIZE));
    }
    setIsMounted(true);
  });

  createEffect(() => {
    if (!isMounted() || !props.storageKey) return;
    writeClientStateCookie(props.storageKey, state());
  });

  const setActivePane = (sectionId: string, paneId: string) => {
    setState((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId && section.paneIds.includes(paneId) ? { ...section, activePaneId: paneId } : section,
      ),
    }));
  };

  const movePane = (paneId: string, targetSectionId: string, beforePaneId?: string) => {
    if (!paneById().has(paneId)) return;
    setState((current) => {
      const next = current.sections
        .map((section) => {
          const paneIds = section.paneIds.filter((id) => id !== paneId);
          return {
            ...section,
            paneIds,
            activePaneId: paneIds.includes(section.activePaneId) ? section.activePaneId : (paneIds[0] ?? ""),
          };
        })
        .filter((section) => section.paneIds.length > 0 || section.id === targetSectionId);

      let target = next.find((section) => section.id === targetSectionId);
      if (!target) {
        target = { id: targetSectionId, size: 0, paneIds: [], activePaneId: paneId };
        next.push(target);
      }

      const insertAt = beforePaneId ? target.paneIds.indexOf(beforePaneId) : -1;
      const targetIds = [...target.paneIds];
      if (insertAt >= 0) targetIds.splice(insertAt, 0, paneId);
      else targetIds.push(paneId);

      const sections = next.map((section) =>
        section.id === targetSectionId ? { ...section, paneIds: targetIds, activePaneId: paneId } : section,
      );
      return { ...current, sections: normalizeSizes(sections) };
    });
  };

  const dragPaneId = (event: DragEvent): string | null => event.dataTransfer?.getData("application/x-dock-pane-id") || null;

  const handleVerticalResize = (event: PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startSize = state().resultSize;
    const height = rootEl?.getBoundingClientRect().height ?? 1;
    const onMove = (move: PointerEvent) => {
      const delta = ((move.clientY - startY) / height) * 100;
      setState((current) => ({ ...current, resultSize: clamp(startSize + delta, MIN_RESULT_SIZE, MAX_RESULT_SIZE) }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleSectionResize = (event: PointerEvent, index: number) => {
    event.preventDefault();
    const startX = event.clientX;
    const startSections = state().sections;
    const width = bottomEl?.getBoundingClientRect().width ?? 1;
    const onMove = (move: PointerEvent) => {
      const delta = ((move.clientX - startX) / width) * 100;
      setState((current) => {
        const sections = current.sections.map((section, sectionIndex) => {
          const start = startSections[sectionIndex];
          if (!start) return section;
          if (sectionIndex === index) return { ...section, size: clamp(start.size + delta, MIN_SECTION_SIZE, 100) };
          if (sectionIndex === index + 1) return { ...section, size: clamp(start.size - delta, MIN_SECTION_SIZE, 100) };
          return section;
        });
        return { ...current, sections: normalizeSizes(sections) };
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={rootEl} class={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent ${props.class ?? ""}`}>
      <Show
        when={result()}
        fallback={<div class="flex min-h-0 flex-1 items-center justify-center text-sm text-dimmed">No result pane configured.</div>}
      >
        {(resultSlot) => (
          <section class="flex min-h-0 flex-col overflow-hidden bg-surface" style={{ height: `${state().resultSize}%` }}>
            <header class="flex h-9 shrink-0 items-center gap-2 px-2 text-xs font-medium text-secondary">
              <i class={`${iconClass(resultSlot().icon, "ti-layout-dashboard")} text-sm`} />
              <span>{resultSlot().title ?? "Result"}</span>
            </header>
            <div class="min-h-0 flex-1 overflow-auto">{resultSlot().children}</div>
          </section>
        )}
      </Show>

      <button
        type="button"
        class="h-2 shrink-0 cursor-row-resize rounded-full bg-transparent transition hover:bg-blue-500/60"
        aria-label="Resize result area"
        onPointerDown={handleVerticalResize}
      />

      <div ref={bottomEl} class="flex min-h-0 flex-1 overflow-hidden">
        <For each={state().sections}>
          {(section, index) => {
            const activePane = createMemo(() => paneById().get(section.activePaneId) ?? paneById().get(section.paneIds[0] ?? ""));
            return (
              <>
                <section
                  class="flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden bg-surface"
                  style={{ width: `${section.size}%` }}
                  role="region"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const paneId = dragPaneId(event);
                    if (paneId) movePane(paneId, section.id);
                  }}
                >
                  <div class="flex h-7 shrink-0 items-start gap-1">
                    <For each={section.paneIds}>
                      {(paneId) => {
                        const pane = createMemo(() => paneById().get(paneId));
                        return (
                          <Show when={pane()}>
                            {(item) => (
                              <button
                                type="button"
                                draggable
                                class={`flex h-7 min-w-0 max-w-48 items-center gap-1.5 rounded bg-zinc-100/75 px-2 text-xs transition dark:bg-zinc-900/60 ${
                                  section.activePaneId === paneId
                                    ? "font-semibold text-blue-700 dark:text-blue-300"
                                    : "text-secondary/75 hover:bg-zinc-100 hover:text-secondary dark:hover:bg-zinc-900"
                                }`}
                                onClick={() => setActivePane(section.id, paneId)}
                                onDragStart={(event) => {
                                  event.dataTransfer?.setData("application/x-dock-pane-id", paneId);
                                  event.dataTransfer?.setData("text/plain", paneId);
                                  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                                }}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const dragged = dragPaneId(event);
                                  if (dragged) movePane(dragged, section.id, paneId);
                                }}
                              >
                                <i class={`${iconClass(item().icon, "ti-layout-sidebar-right")} shrink-0 text-sm`} />
                                <span class="truncate">{item().title}</span>
                              </button>
                            )}
                          </Show>
                        );
                      }}
                    </For>
                  </div>
                  <div class="min-h-0 flex-1 overflow-auto">
                    <Show when={activePane()} fallback={<div class="p-3 text-sm text-dimmed">Drop a pane here.</div>}>
                      {(pane) => pane().children}
                    </Show>
                  </div>
                </section>
                <Show when={index() < state().sections.length - 1}>
                  <button
                    type="button"
                    class="w-2 shrink-0 cursor-col-resize rounded-full bg-transparent transition hover:bg-blue-500/60"
                    aria-label="Resize section"
                    onPointerDown={(event) => handleSectionResize(event, index())}
                  />
                </Show>
              </>
            );
          }}
        </For>
      </div>
    </div>
  );
};

/**
 * @deprecated Use `Panes` for new resizable/tabbed workspaces. DockWorkspace remains only for legacy Pulse screens.
 */
const DockWorkspace = DockWorkspaceRoot as DockWorkspaceComponent;
DockWorkspace.Result = DockWorkspaceResult;
DockWorkspace.Pane = DockWorkspacePane;

export default DockWorkspace;
