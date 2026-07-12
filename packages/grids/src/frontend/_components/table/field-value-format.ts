export { fieldDisplayFormat, relationIds } from "./field-display";

import { fieldDisplayText, type ResolveFieldDisplayOptions, resolveFieldDisplay } from "./field-display";

export const formatFieldValueText = (options: ResolveFieldDisplayOptions): string => fieldDisplayText(resolveFieldDisplay(options));
