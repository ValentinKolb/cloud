import type { DockWorkspaceState } from "@valentinkolb/cloud/ui";
import {
  AppWorkspace,
  isSpotlightShortcut,
  layout,
  openSpotlightSearch,
  SpotlightButton,
  SPOTLIGHT_SHORTCUT_TITLE,
} from "@valentinkolb/cloud/ui";
import { fuzzy } from "@valentinkolb/stdlib";
import { createSignal, onCleanup, onMount } from "solid-js";
import { docHref, findDocPage, type UiLabDocPage, uiLabDocs, uiLabSearchEntries } from "./registry";
import UiLabLayoutHelp from "./UiLabLayoutHelp.island";

type UiLabDocsProps = {
  section: string;
  slug: string;
  markdownHtml: string;
  dockWorkspaceInitialState?: DockWorkspaceState | null;
};

type DocPage = NonNullable<ReturnType<typeof findDocPage>>;

const isPlainLeftClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export default function UiLabDocs(props: UiLabDocsProps) {
  const [route, setRoute] = createSignal({ section: props.section, slug: props.slug });
  let mainScroll: HTMLDivElement | undefined;
  const current = () => findDocPage(route().section, route().slug);
  const currentSectionTitle = () => uiLabDocs.find((group) => group.id === current()?.section)?.title;
  const navigateDoc = (href: string) => {
    const url = new URL(href, window.location.href);
    const match = url.pathname.match(/^\/app\/ui-lab\/([^/]+)\/([^/]+)$/);
    if (!match?.[1] || !match[2]) return null;
    const page = findDocPage(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    const anchor = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;
    return page ? { page, href: url.pathname + url.search + url.hash, anchor } : null;
  };
  const scrollToTarget = (anchor?: string) => {
    requestAnimationFrame(() => {
      if (anchor) {
        document.getElementById(anchor)?.scrollIntoView({ block: "start" });
        return;
      }
      mainScroll?.scrollTo({ top: 0 });
    });
  };
  const applyPage = (page: DocPage, anchor?: string) => {
    setRoute({ section: page.section, slug: page.slug });
    layout.update({
      breadcrumbs: [{ title: "Start", href: "/" }, { title: "UI Lab", href: "/app/ui-lab" }, { title: page.title }],
      title: page.title,
    });
    scrollToTarget(anchor);
  };
  const isActive = (page: UiLabDocPage) => route().section === page.section && route().slug === page.slug;
  const openEntry = (href: string) => {
    const next = navigateDoc(href);
    if (!next) return;
    applyPage(next.page, next.anchor);
    window.history.pushState(null, "", next.href);
  };
  const openSearch = async () => {
    const selected = await openSpotlightSearch<{ href: string }>({
      title: "Search UI Lab",
      icon: "ti ti-palette",
      placeholder: "Search components, utilities, demos...",
      noResultsText: "No UI Lab entries found.",
      resolve: ({ query }) =>
        fuzzy.filter(query.trim(), uiLabSearchEntries, { key: (entry) => entry.keywords, limit: 20 }).map((hit) => {
          const entry = hit.item;
          const href = `${docHref(entry.page)}${entry.anchor ? `#${entry.anchor}` : ""}`;
          return {
            value: { href },
            label: entry.label,
            desc: `${entry.kind === "demo" ? "Demo" : "Page"} · ${entry.description}`,
            icon: entry.icon,
          };
        }),
    });
    if (selected?.value?.href) openEntry(selected.value.href);
  };
  const renderSidebarItem = (page: UiLabDocPage) => (
    <AppWorkspace.SidebarItem
      href={docHref(page)}
      icon={page.icon}
      active={isActive(page)}
      scroll="top"
      onClick={(event) => {
        if (isPlainLeftClick(event)) applyPage(page);
      }}
      onNavigate={(nav) => {
        const next = navigateDoc(nav.href);
        if (!next) return nav.fallback();
        applyPage(next.page, next.anchor);
        nav.push(next.href);
      }}
    >
      {page.title}
    </AppWorkspace.SidebarItem>
  );
  const applyCurrentLocation = () => {
    const next = navigateDoc(window.location.href);
    if (next) applyPage(next.page, next.anchor);
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSpotlightShortcut(event)) {
        event.preventDefault();
        void openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", applyCurrentLocation);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", applyCurrentLocation);
    });
  });

  return (
    <>
      <UiLabLayoutHelp />
      <AppWorkspace class="flex-1 min-h-0">
        <AppWorkspace.Sidebar>
          <AppWorkspace.SidebarHeader title="UI Lab" subtitle="Components and utilities" icon="ti ti-palette" />

          <AppWorkspace.SidebarMobile>
            <AppWorkspace.SidebarMobileItems>
              <SpotlightButton variant="sidebar-mobile" title={`Search UI Lab (${SPOTLIGHT_SHORTCUT_TITLE})`} onClick={openSearch} />
              {uiLabDocs.map((group) => group.pages.map(renderSidebarItem))}
            </AppWorkspace.SidebarMobileItems>
          </AppWorkspace.SidebarMobile>

          <AppWorkspace.SidebarDesktop>
            <AppWorkspace.SidebarBody scrollPreserveKey="ui-lab-docs-sidebar">
              <AppWorkspace.SidebarSection>
                <SpotlightButton variant="sidebar" title={`Search UI Lab (${SPOTLIGHT_SHORTCUT_TITLE})`} onClick={openSearch} />
              </AppWorkspace.SidebarSection>
              {uiLabDocs.map((group) => (
                <AppWorkspace.SidebarSection title={group.title}>{group.pages.map(renderSidebarItem)}</AppWorkspace.SidebarSection>
              ))}
            </AppWorkspace.SidebarBody>
          </AppWorkspace.SidebarDesktop>
        </AppWorkspace.Sidebar>

        <AppWorkspace.Main>
          <div ref={mainScroll} class="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
            <div class="mx-auto flex max-w-6xl flex-col gap-4">
              {current() ? (
                <>
                  <header class="flex flex-col gap-1">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 text-xs text-dimmed">
                        <i class={`${current()!.icon} text-sm`} />
                        <span>{currentSectionTitle()}</span>
                      </div>
                      <h1 class="text-xl font-semibold text-primary">{current()!.title}</h1>
                      <p class="max-w-3xl text-sm text-dimmed">{current()!.summary}</p>
                    </div>
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
    </>
  );
}
