import type { MarkedExtension, Tokens } from "marked";

type GuidedBlock = "compare" | "reference" | "steps";

const guidedBlocks = new Set<GuidedBlock>(["compare", "reference", "steps"]);
const headingMetaPattern = /\s+\{icon="([a-z0-9-]+)"\}\s*$/i;

const slug = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";

const headingTitleTokens = (token: Tokens.Heading, hasMetadata: boolean): Tokens.Heading["tokens"] => {
  if (!hasMetadata) return token.tokens;

  const tokens = [...token.tokens];
  const trailingToken = tokens.at(-1);
  if (trailingToken?.type !== "text") return tokens;

  const raw = trailingToken.raw.replace(headingMetaPattern, "");
  const text = trailingToken.text.replace(headingMetaPattern, "");
  if (!raw && !text) {
    tokens.pop();
  } else {
    tokens[tokens.length - 1] = { ...trailingToken, raw, text };
  }

  return tokens;
};

/**
 * Help-only Markdown affordances. The source stays useful as plain Markdown:
 * the directives merely add reading semantics to otherwise ordinary lists.
 */
export function guidedHelpExtension(): MarkedExtension {
  const headingIds = new Map<string, number>();

  return {
    hooks: {
      preprocess(source) {
        headingIds.clear();
        return source;
      },
    },
    renderer: {
      heading(token: Tokens.Heading) {
        const metadata = token.text.match(headingMetaPattern);
        const title = metadata ? token.text.slice(0, metadata.index).trim() : token.text;
        const baseId = slug(title);
        const occurrence = headingIds.get(baseId) ?? 0;
        headingIds.set(baseId, occurrence + 1);
        const id = occurrence === 0 ? baseId : `${baseId}-${occurrence + 1}`;

        if (token.depth === 2) {
          const icon = metadata?.[1] ? `ti ti-${metadata[1]}` : "ti ti-point";
          return `<h2 id="${id}" class="help-section-title" data-help-icon="${icon}">
  <span class="help-section-icon" aria-hidden="true"><i class="${icon}"></i></span>
  <span>${this.parser.parseInline(headingTitleTokens(token, Boolean(metadata)))}</span>
</h2>`;
        }

        return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>`;
      },
    },
    extensions: [
      {
        name: "guidedHelpBlock",
        level: "block",
        start(source) {
          return source.match(/^:::(?:compare|reference|steps)\b/)?.index;
        },
        tokenizer(source) {
          const match = source.match(/^:::(compare|reference|steps)[ \t]*\n([\s\S]*?)\n:::(?:\n|$)/);
          if (!match) return undefined;
          const kind = match[1] as GuidedBlock;
          if (!guidedBlocks.has(kind)) return undefined;
          const content = match[2]?.trim() ?? "";
          return {
            type: "guidedHelpBlock",
            raw: match[0],
            kind,
            tokens: this.lexer.blockTokens(content),
          };
        },
        renderer(token: Tokens.Generic) {
          const kind = token.kind as GuidedBlock;
          return `<div class="help-${kind}">${this.parser.parse(token.tokens as Tokens.Generic[])}</div>`;
        },
        childTokens: ["tokens"],
      },
    ],
  };
}
