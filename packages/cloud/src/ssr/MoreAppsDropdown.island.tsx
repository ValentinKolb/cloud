import { Dropdown } from "../ui";

type AppLink = {
  iconClass: string;
  label: string;
  href: string;
};

type LegalLink = {
  label: string;
  href: string;
  icon?: string;
};

type MoreAppsDropdownProps = {
  apps: AppLink[];
  /**
   * Legal/info links contributed by every running app via `defineApp.legalLinks`.
   * Computed server-side via `listLegalLinks()` (or the runtime aggregation in
   * Layout.tsx) and passed in as a prop. Empty array = section hidden.
   */
  legalLinks?: LegalLink[];
};

/** Dropdown for secondary apps in the rail nav. */
export default function MoreAppsDropdown(props: MoreAppsDropdownProps) {
  const legalLinks = props.legalLinks ?? [];
  const trigger = (
    <span class="rail-item" title="More">
      <i class="ti ti-dots-vertical text-base" />
    </span>
  );

  const appItems = props.apps.map((app) => ({
    icon: app.iconClass,
    label: app.label,
    href: app.href,
  }));

  const legalItems = legalLinks.map((link) => ({
    icon: link.icon ?? "ti ti-file-text",
    label: link.label,
    href: link.href,
  }));

  const elements = legalItems.length > 0
    ? [
        ...(appItems.length > 0 ? [{ items: appItems }] : []),
        { sectionLabel: "Legal", items: legalItems },
      ]
    : appItems;

  return (
    <Dropdown
      trigger={trigger}
      elements={elements}
      position="bottom-right"
      width="w-44"
    />
  );
}
