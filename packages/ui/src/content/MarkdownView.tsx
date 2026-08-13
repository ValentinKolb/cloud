import { marked, Renderer, type Tokens } from "marked";

type CommonProps = {
  /** Optional additional CSS classes */
  class?: string;
  /**
   * Visual heading scale. Markdown heading levels and document structure stay
   * unchanged.
   */
  headingScale?: "compact" | "normal" | "large";
};

export type MarkdownViewProps = CommonProps &
  (
    | {
        /** Untrusted Markdown. Raw HTML and unsafe link protocols are escaped. */
        markdown: string;
        trustedHtml?: never;
      }
    | {
        /** Explicitly trusted, already-rendered HTML. The caller owns sanitization. */
        trustedHtml: string;
        markdown?: never;
      }
  );

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const safeUrl = (value: string): string | null => {
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, "");
  if (/^(?:javascript|vbscript|data):/i.test(normalized)) return null;
  return value;
};

const createSafeRenderer = (): Renderer => {
  const renderer = new Renderer();
  renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
  renderer.link = function ({ href, title, tokens }: Tokens.Link) {
    const body = this.parser.parseInline(tokens);
    const url = safeUrl(href);
    if (!url) return body;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(url)}"${titleAttribute}>${body}</a>`;
  };
  renderer.image = ({ href, title, text }: Tokens.Image) => {
    const url = safeUrl(href);
    if (!url) return escapeHtml(text);
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttribute}>`;
  };
  return renderer;
};

export const renderSafeMarkdown = (markdown: string): string =>
  marked.parse(markdown, { async: false, renderer: createSafeRenderer() }) as string;

/**
 * Markdown View Component (SSR)
 *
 * Renders untrusted Markdown safely by default. Raw HTML and unsafe link
 * protocols are escaped. Already-rendered HTML requires the deliberately named
 * `trustedHtml` boundary; the caller owns sanitization in that mode.
 *
 * @example
 * ```tsx
 * import { MarkdownView } from "@k2b/ui";
 *
 * <MarkdownView markdown={source} />;
 * ```
 *
 * @example Compact headings, e.g. inside comments or file previews:
 * ```tsx
 * <MarkdownView markdown={source} headingScale="compact" />;
 * ```
 */
export default function MarkdownView(props: MarkdownViewProps) {
  const html = () => (props.markdown !== undefined ? renderSafeMarkdown(props.markdown) : props.trustedHtml);
  return (
    <div
      class={`k2b-content-markdown ${props.class ?? ""}`}
      data-heading-scale={props.headingScale && props.headingScale !== "normal" ? props.headingScale : undefined}
      innerHTML={html()}
    />
  );
}
