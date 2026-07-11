import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import type { FileBaseInfo } from "@/contracts";

type BaseSidebarProps = {
  bases: FileBaseInfo[];
  currentBaseType: string;
  currentBaseId: string;
  settingsPanel?: () => JSX.Element;
};

const isActive = (base: FileBaseInfo, currentBaseType: string, currentBaseId: string) => {
  if (base.type === "home") {
    return currentBaseType === "home" && currentBaseId === base.id;
  }
  return currentBaseType === "group" && currentBaseId === base.id;
};

const getHref = (base: FileBaseInfo) => {
  return base.type === "home" ? "/app/files/home" : `/app/files/group/${base.id}`;
};

const getHomeLabel = (name: string) => name.replace("Home (", "").replace(")", "");

export default function BaseSidebar(props: BaseSidebarProps) {
  const homeBases = props.bases.filter((b) => b.type === "home");
  const groupBases = props.bases.filter((b) => b.type === "group");
  const isSearch = props.currentBaseType === "search";
  const currentBase = props.bases.find((base) => isActive(base, props.currentBaseType, props.currentBaseId));
  const currentBaseLabel = currentBase ? (currentBase.type === "home" ? getHomeLabel(currentBase.name) : currentBase.name) : null;
  const sidebarTitle = isSearch ? "Search" : (currentBaseLabel ?? "Files");
  const sidebarSubtitle = isSearch
    ? "Files"
    : currentBase?.type === "home"
      ? "Personal files"
      : currentBase?.type === "group"
        ? "Group files"
        : undefined;
  const renderBaseItem = (base: FileBaseInfo) => (
    <AppWorkspace.SidebarItem
      href={getHref(base)}
      navigation="document"
      icon={base.type === "home" ? "ti ti-home" : "ti ti-users-group"}
      active={isActive(base, props.currentBaseType, props.currentBaseId)}
    >
      {base.type === "home" ? getHomeLabel(base.name) : base.name}
    </AppWorkspace.SidebarItem>
  );

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader
        title={sidebarTitle}
        subtitle={sidebarSubtitle}
        icon="ti ti-folders"
        iconStyle="background-color: var(--color-blue-500)"
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          <AppWorkspace.SidebarItem href="/app/files/search" navigation="document" icon="ti ti-search" active={isSearch}>
            Search
          </AppWorkspace.SidebarItem>
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="files-sidebar-mobile">
          <AppWorkspace.SidebarSection>
            {props.bases.map(renderBaseItem)}
            {props.bases.length === 0 && (
              <p class="px-2 py-1 text-xs text-dimmed">
                <i class="ti ti-folder-off mr-1" />
                No accessible bases
              </p>
            )}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <div class="flex flex-col gap-3">
          <AppWorkspace.SidebarSection title="Actions">
            <AppWorkspace.SidebarItem href="/app/files/search" navigation="document" icon="ti ti-search" active={isSearch}>
              Search
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
        </div>

        <AppWorkspace.SidebarBody scrollPreserveKey="files-sidebar">
          {homeBases.length > 0 && <AppWorkspace.SidebarSection title="Home">{homeBases.map(renderBaseItem)}</AppWorkspace.SidebarSection>}

          {groupBases.length > 0 && (
            <AppWorkspace.SidebarSection title="Groups">{groupBases.map(renderBaseItem)}</AppWorkspace.SidebarSection>
          )}

          {props.bases.length === 0 && (
            <p class="px-2 py-1 text-xs text-dimmed">
              <i class="ti ti-folder-off mr-1" />
              No accessible bases
            </p>
          )}

          {props.settingsPanel ? <AppWorkspace.SidebarSection>{props.settingsPanel()}</AppWorkspace.SidebarSection> : null}
        </AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
