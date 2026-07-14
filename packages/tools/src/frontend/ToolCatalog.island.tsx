import { TextInput } from "@valentinkolb/cloud/ui";
import { fuzzy } from "@valentinkolb/stdlib";
import { createMemo, createSignal, For, Show } from "solid-js";
import { taskGroupOrder, taskGroups, tools, toolSearchText, type ToolDef, type ToolTaskGroup } from "./tools/registry";

const toolHref = (tool: ToolDef): string => `/tools/${tool.id}`;

const ToolIcon = (props: { tool: ToolDef }) => (
  <span class="tools-tool-icon">
    <i class={`${props.tool.icon} text-base`} />
  </span>
);

const QuickTool = (props: { tool: ToolDef }) => (
  <a
    href={toolHref(props.tool)}
    class="paper focus-ui group/quick flex min-h-24 items-start gap-3 p-3 transition-colors hover:paper-highlighted"
  >
    <ToolIcon tool={props.tool} />
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-semibold text-primary transition-colors group-hover/quick:app-accent-text">{props.tool.name}</span>
      <span class="mt-0.5 block text-xs leading-5 text-dimmed">{props.tool.description}</span>
    </span>
    <i class="ti ti-chevron-right mt-1 shrink-0 text-xs text-dimmed transition-transform group-hover/quick:translate-x-0.5 group-hover/quick:app-accent-text" />
  </a>
);

const ToolRow = (props: { tool: ToolDef }) => (
  <a
    href={toolHref(props.tool)}
    class="focus-ui group/tool flex min-h-14 items-center gap-3 rounded-[var(--ui-radius-control)] px-2 py-2 transition-colors hover:bg-[var(--ui-hover)]"
  >
    <ToolIcon tool={props.tool} />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium text-secondary transition-colors group-hover/tool:app-accent-text">
        {props.tool.name}
      </span>
      <span class="block truncate text-xs text-dimmed">{props.tool.description}</span>
    </span>
    <i class="ti ti-chevron-right shrink-0 text-xs text-dimmed transition-transform group-hover/tool:translate-x-0.5 group-hover/tool:app-accent-text" />
  </a>
);

export default function ToolCatalog() {
  const [query, setQuery] = createSignal("");
  const normalizedQuery = createMemo(() => query().trim().toLowerCase());
  const matches = createMemo(() => {
    const needle = normalizedQuery();
    return needle ? fuzzy.filter(needle, tools, { key: toolSearchText }).map((hit) => hit.item) : tools;
  });
  const featured = createMemo(() => tools.filter((tool) => tool.featured));
  const toolsForGroup = (group: ToolTaskGroup) => matches().filter((tool) => tool.taskGroup === group);

  return (
    <div class="flex flex-col gap-5">
      <TextInput
        type="search"
        ariaLabel="Search tools"
        icon="ti ti-search"
        value={query}
        onInput={setQuery}
        onClear={() => setQuery("")}
        placeholder='What do you want to do? Try "resize image" or "random ID"'
        clearable
        autocomplete="off"
        spellcheck={false}
      />

      <Show when={!normalizedQuery()}>
        <section class="flex flex-col gap-2" aria-labelledby="quick-tools-title">
          <header>
            <h3 id="quick-tools-title" class="text-sm font-semibold text-primary">
              Quick tools
            </h3>
            <p class="text-xs text-dimmed">Common tasks, one click away.</p>
          </header>
          <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <For each={featured()}>{(tool) => <QuickTool tool={tool} />}</For>
          </div>
        </section>
      </Show>

      <section class="flex flex-col gap-2" aria-labelledby="all-tools-title">
        <header>
          <h3 id="all-tools-title" class="text-sm font-semibold text-primary">
            {normalizedQuery() ? "Search results" : "Browse all"}
          </h3>
          <p class="text-xs text-dimmed">
            {normalizedQuery()
              ? `${matches().length} matching ${matches().length === 1 ? "tool" : "tools"}.`
              : "Grouped by the task you want to complete."}
          </p>
        </header>

        <Show
          when={matches().length > 0}
          fallback={
            <div class="rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] px-4 py-8 text-center">
              <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-[var(--ui-radius-control)] border border-[var(--ui-state-icon-border)] bg-[var(--ui-state-icon-surface)] text-dimmed">
                <i class="ti ti-search-off text-base" />
              </div>
              <p class="text-sm font-medium text-primary">No tools match this task</p>
              <p class="mt-0.5 text-xs text-dimmed">Try a tool name, format, or action.</p>
            </div>
          }
        >
          <div class="grid gap-x-5 gap-y-4 lg:grid-cols-2">
            <For each={taskGroupOrder}>
              {(group) => {
                const groupTools = () => toolsForGroup(group);
                return (
                  <Show when={groupTools().length > 0}>
                    <section class="min-w-0" aria-labelledby={`tool-group-${group}`}>
                      <header class="flex min-h-9 items-start gap-2 px-2 py-1.5">
                        <i class={`${taskGroups[group].icon} app-accent-text mt-0.5 text-sm`} />
                        <span class="min-w-0 flex-1">
                          <h4 id={`tool-group-${group}`} class="text-sm font-medium text-primary">
                            {taskGroups[group].label}
                          </h4>
                          <p class="truncate text-xs text-dimmed">{taskGroups[group].description}</p>
                        </span>
                        <span class="text-xs tabular-nums text-dimmed">{groupTools().length}</span>
                      </header>
                      <div class="flex flex-col">
                        <For each={groupTools()}>{(tool) => <ToolRow tool={tool} />}</For>
                      </div>
                    </section>
                  </Show>
                );
              }}
            </For>
          </div>
        </Show>
      </section>
    </div>
  );
}
