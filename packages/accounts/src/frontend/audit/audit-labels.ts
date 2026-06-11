import type { FilterChipSection } from "@valentinkolb/cloud/ui";

const ACTION_LABEL: Record<string, string> = {
  "accounts.user.create": "Create user",
  "accounts.user.update": "Update user",
  "accounts.user.password_reset": "Reset password",
  "accounts.user.set_expiry": "Set expiry",
  "accounts.user.set_profile": "Set profile",
  "accounts.user.set_admin": "Set admin",
  "accounts.user.switch_provider": "Switch provider",
  "accounts.user.demote_to_guest": "Demote user",
  "accounts.user.create_login_token": "Create login token",
  "accounts.user.send_login_link": "Send login link",
  "accounts.user.remove": "Delete user",
  "accounts.user.remove_self": "Self-delete",
  "accounts.user.change_own_password": "Change password",
  "accounts.user.extend_account": "Extend account",
  "accounts.group.create": "Create group",
  "accounts.group.update": "Update group",
  "accounts.group.remove": "Delete group",
  "accounts.group.make_posix": "Make POSIX",
  "accounts.group.member.add": "Add member",
  "accounts.group.member.remove": "Remove member",
  "accounts.group.manager.add": "Add manager",
  "accounts.group.manager.remove": "Remove manager",
  "accounts.request.create": "Create request",
  "accounts.request.withdraw": "Withdraw request",
  "accounts.request.deny": "Deny request",
  "service_account_credential.create": "Create API key",
  "service_account_credential.revoke": "Revoke API key",
  "service_account_credential.authenticate": "Use API key",
};

export const actionLabel = (action: string): string => ACTION_LABEL[action] ?? action;

export const ACTION_OPTIONS: FilterChipSection[] = [
  {
    label: "Users",
    options: [
      { value: "accounts.user.create", label: ACTION_LABEL["accounts.user.create"]!, icon: "ti ti-user-plus" },
      { value: "accounts.user.update", label: ACTION_LABEL["accounts.user.update"]!, icon: "ti ti-user-edit" },
      { value: "accounts.user.password_reset", label: ACTION_LABEL["accounts.user.password_reset"]!, icon: "ti ti-key" },
      { value: "accounts.user.set_expiry", label: ACTION_LABEL["accounts.user.set_expiry"]!, icon: "ti ti-calendar-due" },
      { value: "accounts.user.set_profile", label: ACTION_LABEL["accounts.user.set_profile"]!, icon: "ti ti-badge" },
      { value: "accounts.user.set_admin", label: ACTION_LABEL["accounts.user.set_admin"]!, icon: "ti ti-shield" },
      { value: "accounts.user.switch_provider", label: ACTION_LABEL["accounts.user.switch_provider"]!, icon: "ti ti-switch-horizontal" },
      { value: "accounts.user.demote_to_guest", label: ACTION_LABEL["accounts.user.demote_to_guest"]!, icon: "ti ti-user-down" },
      { value: "accounts.user.create_login_token", label: ACTION_LABEL["accounts.user.create_login_token"]!, icon: "ti ti-ticket" },
      { value: "accounts.user.send_login_link", label: ACTION_LABEL["accounts.user.send_login_link"]!, icon: "ti ti-mail-share" },
      { value: "accounts.user.remove", label: ACTION_LABEL["accounts.user.remove"]!, icon: "ti ti-trash" },
      { value: "accounts.user.remove_self", label: ACTION_LABEL["accounts.user.remove_self"]!, icon: "ti ti-user-x" },
      { value: "accounts.user.change_own_password", label: ACTION_LABEL["accounts.user.change_own_password"]!, icon: "ti ti-lock" },
      { value: "accounts.user.extend_account", label: ACTION_LABEL["accounts.user.extend_account"]!, icon: "ti ti-calendar-plus" },
    ],
  },
  {
    label: "Groups",
    options: [
      { value: "accounts.group.create", label: ACTION_LABEL["accounts.group.create"]!, icon: "ti ti-users-plus" },
      { value: "accounts.group.update", label: ACTION_LABEL["accounts.group.update"]!, icon: "ti ti-edit" },
      { value: "accounts.group.remove", label: ACTION_LABEL["accounts.group.remove"]!, icon: "ti ti-trash" },
      { value: "accounts.group.make_posix", label: ACTION_LABEL["accounts.group.make_posix"]!, icon: "ti ti-terminal-2" },
      { value: "accounts.group.member.add", label: ACTION_LABEL["accounts.group.member.add"]!, icon: "ti ti-user-plus" },
      { value: "accounts.group.member.remove", label: ACTION_LABEL["accounts.group.member.remove"]!, icon: "ti ti-user-minus" },
      { value: "accounts.group.manager.add", label: ACTION_LABEL["accounts.group.manager.add"]!, icon: "ti ti-shield-plus" },
      { value: "accounts.group.manager.remove", label: ACTION_LABEL["accounts.group.manager.remove"]!, icon: "ti ti-shield-minus" },
    ],
  },
  {
    label: "Requests",
    options: [
      { value: "accounts.request.create", label: ACTION_LABEL["accounts.request.create"]!, icon: "ti ti-inbox" },
      { value: "accounts.request.withdraw", label: ACTION_LABEL["accounts.request.withdraw"]!, icon: "ti ti-arrow-back-up" },
      { value: "accounts.request.deny", label: ACTION_LABEL["accounts.request.deny"]!, icon: "ti ti-ban" },
    ],
  },
  {
    label: "Service Accounts",
    options: [
      { value: "service_account_credential.create", label: ACTION_LABEL["service_account_credential.create"]!, icon: "ti ti-key" },
      { value: "service_account_credential.revoke", label: ACTION_LABEL["service_account_credential.revoke"]!, icon: "ti ti-key-off" },
      {
        value: "service_account_credential.authenticate",
        label: ACTION_LABEL["service_account_credential.authenticate"]!,
        icon: "ti ti-login",
      },
    ],
  },
];
