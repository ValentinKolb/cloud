import { browserNotificationClient } from "@valentinkolb/cloud/browser/notifications";
import { apiClient } from "@valentinkolb/cloud/clients/core";

export const signOutCurrentSession = async (): Promise<void> => {
  await browserNotificationClient.disable().catch(() => undefined);
  const response = await apiClient.auth.logout.$post();
  if (!response.ok) throw new Error("Sign out failed. Please try again.");
  window.location.href = "/auth/login";
};
