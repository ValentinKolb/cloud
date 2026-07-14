import { Dropdown, type DropdownItem } from "@valentinkolb/cloud/ui";
import type { User } from "@/contracts";
import { createUserActions } from "./user-actions/use-user-actions";

type UserActionsProps = {
  user: User;
  listHref: string;
  freeIpaEnabled: boolean;
};

export default function UserActions(props: UserActionsProps) {
  const actions = createUserActions(props);
  const accessItems: Extract<DropdownItem, { items: unknown }>["items"] = [
    ...(actions.isIpaUser && props.freeIpaEnabled
      ? [
          {
            icon: "ti ti-home-move",
            label: "Make Local",
            action: actions.handleMakeLocal,
          },
          {
            icon: "ti ti-lock-open",
            label: "Reset Password",
            action: actions.handleResetPassword,
            variant: "danger" as const,
          },
        ]
      : []),
    ...(actions.isLocalUser
      ? [
          ...(actions.canCreateLoginToken
            ? [
                {
                  icon: "ti ti-key",
                  label: "Login Token",
                  action: actions.handleCreateLoginToken,
                },
              ]
            : []),
          {
            icon: actions.isGuestProfile ? "ti ti-user-up" : "ti ti-user-down",
            label: actions.isGuestProfile ? "Promote" : "Demote",
            action: () => actions.handleSetProfile(actions.isGuestProfile ? "user" : "guest"),
          },
          ...(actions.isGuestProfile
            ? []
            : [
                {
                  icon: actions.isLocalAdmin ? "ti ti-shield-x" : "ti ti-shield-check",
                  label: actions.isLocalAdmin ? "Revoke Admin" : "Grant Admin",
                  action: () => actions.handleSetAdmin(!actions.isLocalAdmin),
                },
              ]),
        ]
      : []),
    ...(actions.canCreateIpa
      ? [
          {
            icon: "ti ti-building-fortress",
            label: "Create FreeIPA",
            action: actions.handleCreateIpa,
          },
        ]
      : []),
  ];

  const menuElements: DropdownItem[] = [
    {
      sectionLabel: "Audit",
      items: [
        {
          icon: "ti ti-clipboard-list",
          label: "Actions by user",
          href: actions.auditByUserHref,
        },
        {
          icon: "ti ti-user-search",
          label: "Actions on user",
          href: actions.auditOnUserHref,
        },
      ],
    },
    {
      sectionLabel: "Account",
      items: [
        {
          icon: "ti ti-camera",
          label: "Change Avatar",
          action: actions.handleChangeAvatar,
        },
        ...(actions.canMutateUser
          ? [
              {
                icon: "ti ti-pencil",
                label: "Edit",
                action: actions.handleEdit,
              },
            ]
          : []),
        {
          icon: "ti ti-send",
          label: "Notify",
          action: actions.handleNotify,
        },
        ...(actions.canSetExpiry
          ? [
              {
                icon: "ti ti-calendar",
                label: "Set Expiry",
                action: actions.handleSetExpiry,
              },
            ]
          : []),
      ],
    },
    ...(accessItems.length
      ? [
          {
            sectionLabel: "Access",
            items: accessItems,
          },
        ]
      : []),
    ...(actions.canMutateUser
      ? [
          {
            sectionLabel: "Danger zone",
            items: [
              {
                icon: "ti ti-trash",
                label: "Delete",
                action: actions.handleDestroy,
                variant: "danger" as const,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <Dropdown
      trigger={
        <button type="button" class="btn-input btn-input-sm" aria-label="User actions">
          <i class="ti ti-dots-vertical text-sm" />
          Actions
        </button>
      }
      position="bottom-left"
      width="w-56"
      elements={menuElements}
    />
  );
}
