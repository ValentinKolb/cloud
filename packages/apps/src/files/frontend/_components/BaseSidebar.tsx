import type { FileBaseInfo } from "@/files/contracts";
type BaseSidebarProps = { bases: FileBaseInfo[]; currentBaseType: string; currentBaseId: string };
const isActive = (base: FileBaseInfo, currentBaseType: string, currentBaseId: string) => {
  if (base.type === "home") {
    return currentBaseType === "home" && currentBaseId === base.id;
  }
  return currentBaseType === "group" && currentBaseId === base.id;
};
const getHref = (base: FileBaseInfo) => {
  return base.type === "home" ? "/app/files/home" : `/app/files/group/${base.id}`;
}; /** * Mobile navigation - horizontal wrapping chips */
function MobileNav({ bases, currentBaseType, currentBaseId }: BaseSidebarProps) {
  const isSearch = currentBaseType === "search";
  return (
    <nav class="lg:hidden flex flex-wrap gap-1.5">
      {" "}
      {/* Search chip */}{" "}
      <a
        href="/app/files/search"
        class={`chip ${isSearch ? "bg-zinc-200 dark:bg-zinc-700 text-primary font-medium" : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
      >
        {" "}
        <i class="ti ti-search" /> Search{" "}
      </a>{" "}
      {bases.map((base) => {
        const active = isActive(base, currentBaseType, currentBaseId);
        const label = base.type === "home" ? base.name.replace("Home (", "").replace(")", "") : base.name;
        return (
          <a
            href={getHref(base)}
            class={`chip ${active ? "bg-zinc-200 dark:bg-zinc-700 text-primary font-medium" : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            {" "}
            {label}{" "}
          </a>
        );
      })}{" "}
    </nav>
  );
} /** * Desktop navigation - vertical sidebar with sections */
function DesktopNav({ bases, currentBaseType, currentBaseId }: BaseSidebarProps) {
  const homeBases = bases.filter((b) => b.type === "home");
  const groupBases = bases.filter((b) => b.type === "group");
  const isSearch = currentBaseType === "search";
  return (
    <nav class="hidden lg:flex flex-col py-3 overflow-y-auto">
      {" "}
      {/* Global search */}{" "}
      <a href="/app/files/search" class={`list-item text-xs ${isSearch ? "list-item-active" : ""}`}>
        {" "}
        <i class="ti ti-search text-sm" /> <span>Search</span>{" "}
      </a>{" "}
      {/* Home directories */}{" "}
      {homeBases.length > 0 && (
        <>
          {" "}
          <div class="section-label mb-1 mt-3">Home</div>{" "}
          {homeBases.map((base) => {
            const active = isActive(base, currentBaseType, currentBaseId);
            return (
              <a href={getHref(base)} class={`list-item text-xs ${active ? "list-item-active" : ""}`}>
                {" "}
                <i class="ti ti-home text-sm" /> <span class="truncate">{base.name.replace("Home (", "").replace(")", "")}</span>{" "}
              </a>
            );
          })}{" "}
        </>
      )}{" "}
      {/* Group directories */}{" "}
      {groupBases.length > 0 && (
        <>
          {" "}
          <div class="section-label mb-1 mt-3">Groups</div>{" "}
          {groupBases.map((base) => {
            const active = isActive(base, currentBaseType, currentBaseId);
            return (
              <a href={getHref(base)} class={`list-item text-xs ${active ? "list-item-active" : ""}`}>
                {" "}
                <i class="ti ti-users-group text-sm" /> <span class="truncate">{base.name}</span>{" "}
              </a>
            );
          })}{" "}
        </>
      )}{" "}
      {bases.length === 0 && <div class="px-2 py-3 text-xs text-dimmed text-center">No accessible bases</div>}{" "}
    </nav>
  );
} /** * Base navigation - shows mobile chips or desktop sidebar based on screen size. */
export default function BaseSidebar(props: BaseSidebarProps) {
  return (
    <>
      {" "}
      <MobileNav {...props} /> <DesktopNav {...props} />{" "}
    </>
  );
}
