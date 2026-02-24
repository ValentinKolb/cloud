import { Dropdown } from "@valentinkolb/cloud-lib/ui";

type AppLink = {
  iconClass: string;
  label: string;
  href: string;
};

type MoreAppsDropdownProps = {
  apps: AppLink[];
  /** Render style: "tab" for horizontal tab bar, "rail" for icon rail */
  variant?: "tab" | "rail";
  includeLegal?: boolean;
};

/** Dropdown for secondary apps ("More" button in tab bar or icon rail). */
export default function MoreAppsDropdown(props: MoreAppsDropdownProps) {
  const variant = props.variant ?? "tab";
  const includeLegal = props.includeLegal ?? false;

  const trigger =
    variant === "rail" ? (
      <span class="rail-item" title="More">
        <i class="ti ti-dots-vertical text-base" />
      </span>
    ) : (
      <span class="tab-item">
        <i class="ti ti-layout-grid-add text-sm" />
        <span class="">More</span>
      </span>
    );

  const appItems = props.apps.map((app) => ({
    icon: app.iconClass,
    label: app.label,
    href: app.href,
  }));

  const elements = includeLegal
    ? [
        ...(appItems.length > 0
          ? [
              {
                items: appItems,
              },
            ]
          : []),
        {
          sectionLabel: "Legal",
          items: [
            {
              icon: "ti ti-file-text",
              label: "Impressum",
              href: "/impressum",
            },
            {
              icon: "ti ti-shield-lock",
              label: "Datenschutz",
              href: "/legal/datenschutz",
            },
          ],
        },
      ]
    : appItems;

  return (
    <Dropdown
      trigger={trigger}
      elements={elements}
      position={variant === "rail" ? "bottom-right" : "bottom-right"}
      width="w-44"
    />
  );
}
