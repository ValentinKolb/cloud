import * as ipa from "./ipa";
import * as magicLink from "./magic-link";

export { ipa, magicLink };

export const authFlows = { ipa, magicLink } as const;
