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
 * Displays pre-rendered markdown HTML with prose styling.
 * This component does not set a max-width - the parent should control that.
 *
 * @example
 * ```tsx
 * // Server-side (in page.tsx):
 * import { renderMarkdown } from "@/shared/markdown";
 * const html = renderMarkdown(markdownContent);
 *
 * // In your component:
 * import MarkdownView from "@/ui/misc/MarkdownView";
 * <div class="max-w-4xl mx-auto">
 *   <MarkdownView html={html} />
 * </div>
 * ```
 *
 * @example With Mermaid & KaTeX support (in an island component):
 * ```tsx
 * import { onMount } from "solid-js";
 * import MarkdownView from "@/ui/misc/MarkdownView";
 * import { initMarkdownEnhancements } from "@/shared/markdown/client";
 *
 * export default function MyComponent(props: { html: string }) {
 *   let containerRef: HTMLDivElement | undefined;
 *
 *   onMount(() => {
 *     if (containerRef) {
 *       initMarkdownEnhancements(containerRef);
 *     }
 *   });
 *
 *   return (
 *     <div ref={containerRef}>
 *       <MarkdownView html={props.html} />
 *     </div>
 *   );
 * }
 * ```
 */
export default function MarkdownView(props: Props) {
  const classes = () => {
    const base = "prose prose-sm dark:prose-invert max-w-none";
    const small = props.smallHeadings
      ? "[&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm [&_h5]:!text-sm [&_h6]:!text-sm [&_h1]:!font-semibold [&_h2]:!font-semibold [&_h3]:!font-semibold [&_h4]:!font-semibold [&_h5]:!font-semibold [&_h6]:!font-semibold [&_h1]:!my-0 [&_h2]:!my-0 [&_h3]:!my-0 [&_h4]:!my-0 [&_h5]:!my-0 [&_h6]:!my-0 [&_h1]:!underline [&_h2]:!underline [&_h3]:!underline [&_h4]:!underline [&_h5]:!underline [&_h6]:!underline"
      : "";
    return `${base} ${small} ${props.class ?? ""}`;
  };

  return <div class={classes()} innerHTML={props.html} />;
}
