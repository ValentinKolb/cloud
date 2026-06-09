import * as ipa from "./ipa";
import * as magicLink from "./magic-link";
import * as proxyReturn from "./proxy-return";

export { ipa, magicLink, proxyReturn };

export const authFlows = { ipa, magicLink, proxyReturn } as const;
