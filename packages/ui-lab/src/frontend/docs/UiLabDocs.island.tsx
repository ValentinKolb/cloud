import { AppWorkspace, layout } from "@valentinkolb/cloud/ui";
import type { DockWorkspaceState } from "@valentinkolb/cloud/ui";
import { createSignal, onCleanup, onMount } from "solid-js";
import { docHref, findDocPage, uiLabDocs } from "./registry";

type UiLabDocsProps = {
  section: string;
  slug: string;
  markdownHtml: string;
  dockWorkspaceInitialState?: DockWorkspaceState | null;
};

export default function UiLabDocs(props: UiLabDocsProps) {
  const [route, setRoute] = createSignal({ section: props.section, slug: props.slug });
  const current = () => findDocPage(route().section, route().slug);
  const currentSectionTitle = () => uiLabDocs.find((group) => group.id === current()?.section)?.title;
  const navigateDoc = (href: string) => {
    const url = new URL(href, window.location.href);
    const match = url.pathname.match(/^\/app\/ui-lab\/([^/]+)\/([^/]+)$/);
    if (!match?.[1] || !match[2]) return null;
    const page = findDocPage(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    return page ? { page, href: url.pathname + url.search + url.hash } : null;
  };
  const applyPage = (page: NonNullable<ReturnType<typeof findDocPage>>) => {
    setRoute({ section: page.section, slug: page.slug });
    layout.update({
      breadcrumbs: [{ title: "Start", href: "/" }, { title: "UI Lab", href: "/app/ui-lab" }, { title: page.title }],
      title: page.title,
    });
  };
  const isActive = (page: NonNullable<ReturnType<typeof findDocPage>>) => route().section === page.section && route().slug === page.slug;
  const applyCurrentLocation = () => {
    const next = navigateDoc(window.location.href);
    if (next) applyPage(next.page);
  };

  onMount(() => {
    window.addEventListener("popstate", applyCurrentLocation);
    onCleanup(() => window.removeEventListener("popstate", applyCurrentLocation));
  });

  return (
    <AppWorkspace class="flex-1 min-h-0">
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader title="UI Lab" subtitle="Components and utilities" icon="ti ti-palette" />

        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems>
            {uiLabDocs.map((group) =>
              group.pages.map((page) => (
                <AppWorkspace.SidebarItem
                  href={docHref(page)}
                  icon={page.icon}
                  active={isActive(page)}
                  scroll="top"
                  onClick={(event) => {
                    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                      return;
                    applyPage(page);
                  }}
                  onNavigate={(nav) => {
                    const next = navigateDoc(nav.href);
                    if (!next) return nav.fallback();
                    applyPage(next.page);
                    nav.push(next.href);
                  }}
                >
                  {page.title}
                </AppWorkspace.SidebarItem>
              )),
            )}
          </AppWorkspace.SidebarMobileItems>
        </AppWorkspace.SidebarMobile>

        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey="ui-lab-docs-sidebar">
            {uiLabDocs.map((group) => (
              <AppWorkspace.SidebarSection title={group.title}>
                {group.pages.map((page) => (
                  <AppWorkspace.SidebarItem
                    href={docHref(page)}
                    icon={page.icon}
                    active={isActive(page)}
                    scroll="top"
                    onClick={(event) => {
                      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                        return;
                      applyPage(page);
                    }}
                    onNavigate={(nav) => {
                      const next = navigateDoc(nav.href);
                      if (!next) return nav.fallback();
                      applyPage(next.page);
                      nav.push(next.href);
                    }}
                  >
                    {page.title}
                  </AppWorkspace.SidebarItem>
                ))}
              </AppWorkspace.SidebarSection>
            ))}
          </AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Main>
        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
          <div class="mx-auto flex max-w-6xl flex-col gap-4">
            {current() ? (
              <>
                <header class="flex flex-col gap-1">
                  <div class="flex items-center gap-2 text-xs text-dimmed">
                    <i class={`${current()!.icon} text-sm`} />
                    <span>{currentSectionTitle()}</span>
                  </div>
                  <h1 class="text-xl font-semibold text-primary">{current()!.title}</h1>
                  <p class="max-w-3xl text-sm text-dimmed">{current()!.summary}</p>
                </header>

                {current()!.render({ markdownHtml: props.markdownHtml, dockWorkspaceInitialState: props.dockWorkspaceInitialState })}
              </>
            ) : (
              <div class="paper flex max-w-md flex-col items-center gap-2 self-center p-8 text-center text-xs text-dimmed">
                <i class="ti ti-alert-circle text-2xl" />
                <p>UI Lab page not found.</p>
              </div>
            )}
          </div>
        </div>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
