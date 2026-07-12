import type { TypedNotificationSendResult } from "../notifications/platform";

export type AccountLifecycleNotificationSender = {
  sendExpiryReminder: (input: {
    reminderId: string;
    userId: string;
    firstName: string;
    displayName: string;
    expiresAt: string;
    accountKind: "ipa" | "local-user" | "local-guest";
  }) => Promise<Pick<TypedNotificationSendResult, "id" | "status">>;
};
