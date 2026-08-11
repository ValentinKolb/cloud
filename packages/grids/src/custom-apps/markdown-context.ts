import { type DslQueryContextInput, isDslQueryContextKey } from "../query-dsl/parameters";

const CONTEXT_REFERENCE = /@([a-z]+(?:\.[a-zA-Z0-9_]+)+)/g;

/** Keep request-owned values as text when they are inserted before Markdown parsing. */
export const escapeCustomAppMarkdownValue = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}()#+!|>~:/@.-]/g, (character) => `&#${character.codePointAt(0)};`);

/** Replace only official Custom App context references. Unknown @ text remains ordinary Markdown. */
export const renderCustomAppMarkdown = (source: string, context: DslQueryContextInput): string =>
  source.replace(CONTEXT_REFERENCE, (reference, path: string) => {
    if (!isDslQueryContextKey(path) || !Object.hasOwn(context, path)) return reference;
    const value = context[path];
    return value === null || value === undefined ? "" : escapeCustomAppMarkdownValue(value);
  });
