import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import { docHref, findDocPage, uiLabDocs } from "./registry";

type UiLabDocsProps = {
  section: string;
  slug: string;
  markdownHtml: string;
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
                  active={page === current()}
                  scroll="top"
                  onNavigate={(nav) => {
                    const next = navigateDoc(nav.href);
                    if (!next) return nav.fallback();
                    setRoute({ section: next.page.section, slug: next.page.slug });
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
                    active={page === current()}
                    scroll="top"
                    onNavigate={(nav) => {
                      const next = navigateDoc(nav.href);
                      if (!next) return nav.fallback();
                      setRoute({ section: next.page.section, slug: next.page.slug });
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

                {current()!.render({ markdownHtml: props.markdownHtml })}
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
