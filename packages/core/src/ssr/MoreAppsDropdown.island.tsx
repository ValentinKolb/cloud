import { Dropdown } from "@valentinkolb/cloud-lib/ui";

type AppLink = {
  iconClass: string;
  label: string;
  href: string;
};

type MoreAppsDropdownProps = {
  apps: AppLink[];
  includeLegal?: boolean;
};

/** Dropdown for secondary apps in the rail nav. */
export default function MoreAppsDropdown(props: MoreAppsDropdownProps) {
  const includeLegal = props.includeLegal ?? false;
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
      position="bottom-right"
      width="w-44"
    />
  );
}
