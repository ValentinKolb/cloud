import { browserNotificationClient } from "@valentinkolb/cloud/browser/notifications";
import { apiClient } from "@valentinkolb/cloud/clients/core";

export const signOutCurrentSession = async (): Promise<void> => {
  await browserNotificationClient.disable().catch(() => undefined);
  await apiClient.auth.logout.$post();
  window.location.href = "/auth/login";
};
