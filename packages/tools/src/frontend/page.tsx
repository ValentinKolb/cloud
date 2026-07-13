import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppOverview } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import ToolsLayoutHelp from "./_components/help/ToolsLayoutHelp.island";
import ToolSearchButton from "./ToolSearchButton.island";
import { ToolsWorkspace } from "./ToolsWorkspace";
import { categories, categoryOrder, tools } from "./tools/registry";

export default ssr<AuthContext>(async (c) => {
  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Tools" }]}>
      <ToolsLayoutHelp />
      <ToolsWorkspace>
        <AppOverview title="Tools" subtitle="Focused utilities for common data, media, security, and network tasks." icon="ti ti-tools">
          <AppOverview.Main
            title="All utilities"
            description="Choose a tool or search by task. Most utilities run locally in your browser."
            toolbar={<ToolSearchButton variant="chip" />}
          >
            <div class="grid gap-[var(--ui-space-section)] lg:grid-cols-2">
              {categoryOrder.map((category) => {
                const items = tools.filter((tool) => tool.category === category);
                if (items.length === 0) return null;
                return (
                  <section class="rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-1.5">
                    <header class="flex min-h-9 items-center gap-2 px-2.5 py-2">
                      <i class={`${categories[category].icon} app-accent-text text-sm`} />
                      <h2 class="text-sm font-medium text-primary">{categories[category].label}</h2>
                      <span class="ml-auto text-xs tabular-nums text-dimmed">{items.length}</span>
                    </header>
                    <div class="flex flex-col">
                      {items.map((tool) => (
                        <a
                          href={`/tools/${tool.id}`}
                          class="group/tool focus-ui flex min-h-14 items-center gap-3 rounded-[var(--ui-radius-control)] px-2.5 py-2 transition-colors hover:bg-[var(--ui-hover)]"
                        >
                          <span
                            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] app-accent-text"
                            style="background-color: color-mix(in srgb, var(--app-accent) 10%, var(--ui-surface))"
                          >
                            <i class={`${tool.icon} text-base`} />
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium text-secondary transition-colors group-hover/tool:app-accent-text">
                              {tool.name}
                            </span>
                            <span class="block truncate text-xs text-dimmed">{tool.description}</span>
                          </span>
                          <i class="ti ti-chevron-right shrink-0 text-xs text-dimmed transition-transform group-hover/tool:translate-x-0.5 group-hover/tool:app-accent-text" />
                        </a>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </AppOverview.Main>
        </AppOverview>
      </ToolsWorkspace>
    </Layout>
  );
});
