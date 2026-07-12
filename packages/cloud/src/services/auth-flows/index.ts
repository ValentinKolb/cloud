import * as ipa from "./ipa";
import * as magicLink from "./magic-link";
import * as passwordReset from "./password-reset";
import * as proxyReturn from "./proxy-return";

export type { AuthNotificationDeliveryResult, AuthNotificationSender } from "./notification-sender";

export { ipa, magicLink, passwordReset, proxyReturn };

export const authFlows = {
  ipa,
  magicLink,
  passwordReset,
  proxyReturn,
} as const;
