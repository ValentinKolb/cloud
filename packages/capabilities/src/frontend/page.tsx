import { AppOverview, ButtonLink, LinkCard } from "@k2b/ui";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { For, Show } from "solid-js";
import { loadCapabilityApps } from "../catalog";
import { ssr } from "../config";
import { capabilityHref } from "../routes";
import CapabilitySearchButton, { type CapabilitySearchEntry } from "./CapabilitySearchButton.island";

export default ssr<AuthContext>(async (c) => {
  const catalog = await loadCapabilityApps(new URL(c.req.url));
  const searchEntries: CapabilitySearchEntry[] = catalog.apps.map((app) => ({
    href: capabilityHref({ appId: app.id }),
    label: app.name,
    description: app.description,
    icon: app.icon || "ti ti-apps",
  }));
  c.get("page").title = "Capabilities";

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Capabilities" }]}>
      <div class="k2b-ui min-w-0 flex-1">
        <AppOverview title="Capabilities" subtitle="Inspect and run the live interfaces available to your account." icon="ti ti-api-app">
          <AppOverview.Main
            title="Apps"
            description={`${catalog.apps.length} apps on this page`}
            toolbar={<CapabilitySearchButton entries={searchEntries} registerShortcut />}
          >
            <Show
              when={catalog.apps.length > 0}
              fallback={
                <AppOverview.EmptyState
                  title="No live capabilities"
                  description="Apps with protocol v1 Queries or Actions appear here when they are registered."
                  icon="ti ti-api-app"
                />
              }
            >
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <For each={catalog.apps}>
                  {(app) => (
                    <LinkCard
                      href={capabilityHref({ appId: app.id })}
                      title={app.name}
                      description={app.description}
                      icon={app.icon || "ti ti-apps"}
                      color="violet"
                    />
                  )}
                </For>
              </div>
              <Show when={catalog.cursor || catalog.nextCursor}>
                <nav class="mt-4 flex items-center gap-2" aria-label="Capability app pages">
                  <Show when={catalog.cursor}>
                    <ButtonLink variant="secondary" size="sm" href={capabilityHref({})}>
                      <i class="ti ti-chevrons-left" aria-hidden="true" /> First page
                    </ButtonLink>
                  </Show>
                  <Show when={catalog.nextCursor}>
                    {(cursor) => (
                      <ButtonLink variant="secondary" size="sm" href={capabilityHref({ cursor: cursor() })}>
                        Next page <i class="ti ti-chevron-right" aria-hidden="true" />
                      </ButtonLink>
                    )}
                  </Show>
                </nav>
              </Show>
            </Show>
          </AppOverview.Main>
          <AppOverview.Aside title="Reference" description="Use the same interfaces from scripts and agents.">
            <LinkCard
              href="/app/api-docs"
              title="API documentation"
              description="Explore the underlying HTTP API and schemas."
              icon="ti ti-book-2"
              color="blue"
            />
          </AppOverview.Aside>
        </AppOverview>
      </div>
    </Layout>
  );
});
