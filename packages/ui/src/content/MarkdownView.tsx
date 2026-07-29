type Props = {
  /** Pre-rendered HTML from server-side renderMarkdown() */
  html: string;
  /** Optional additional CSS classes */
  class?: string;
  /**
   * Reduce heading sizes for compact contexts like comments.
   * When true, h1-h6 are all rendered at similar small sizes.
   */
  smallHeadings?: boolean;
};

/**
 * Markdown View Component (SSR)
 *
 * Renders trusted, already-parsed markdown HTML with the package's document
 * typography. The HTML is injected verbatim — sanitize untrusted input before
 * passing it in. This component does not set a max-width; the parent controls
 * the measure.
 *
 * @k2b/ui does not ship a markdown parser export — render the HTML with the
 * parser you already use (`marked`, `markdown-it`, a server helper, …).
 *
 * @example
 * ```tsx
 * import { marked } from "marked";
 * import { MarkdownView } from "@k2b/ui";
 *
 * const html = marked.parse(source, { async: false }) as string;
 *
 * <MarkdownView html={html} />;
 * ```
 *
 * @example Compact headings, e.g. inside comments or file previews:
 * ```tsx
 * <MarkdownView html={html} smallHeadings />;
 * ```
 */
export default function MarkdownView(props: Props) {
  return (
    <div
      class={`k2b-content-markdown ${props.class ?? ""}`}
      data-small-headings={props.smallHeadings ? "true" : undefined}
      innerHTML={props.html}
    />
  );
}
