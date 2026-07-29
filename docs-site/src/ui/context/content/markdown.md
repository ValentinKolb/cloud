# Markdown content

`MarkdownView` renders trusted, pre-rendered HTML with shared prose styles. `MarkdownEditor` owns interactive Markdown editing. The caller owns the Markdown source, HTML rendering, sanitization policy, and persistence.

## Use Markdown content

Use `MarkdownView` for notes, descriptions, comments, help, and generated content whose source is Markdown.

Use `MarkdownEditor` when the same surface also edits Markdown. Use the editor's dedicated component page for its full completion, save, and input API.

## Import

```tsx
import {
  MarkdownEditor,
  MarkdownView,
} from "@k2b/ui";
```

## Render Markdown

`MarkdownView` expects HTML, not Markdown:

```tsx
const html = renderTrustedMarkdown(markdownSource);

<MarkdownView html={html} />;
```

It writes `html` into the document and does not parse or sanitize it itself.
Use an application-owned renderer and sanitize untrusted input before passing
the result.

The component does not impose a reading width. The parent owns width, scrolling, and surrounding layout.

Set `smallHeadings` for compact embedded content such as comments or table details. Use `class` for context-specific text sizing.

## Editing and preview

Keep the Markdown string as the source of truth. Derive preview HTML from that string instead of trying to reconstruct Markdown from rendered HTML.

For a live client preview, call a browser-safe application renderer in a memo
and pass the result to `MarkdownView`. Saving still belongs to the parent
mutation or form.

## Accessibility

Rendered Markdown must preserve a useful heading order and descriptive link text. Do not use `smallHeadings` to repair an incorrect document structure.

Give standalone editors an `aria-label` when no visible label references them.
Preview and edit modes need visible names when both are present.

## Runtime

`MarkdownView` is server-renderable and needs no hydration for ordinary HTML.
Optional client enhancements belong to the hydrated host.

`MarkdownEditor` and a reactive live preview require hydration. The initial preview can still be rendered on the server from the initial Markdown value.

## Example

```tsx
const [source, setSource] = createSignal("# Release notes");
const html = createMemo(() => renderTrustedMarkdown(source()));

<div class="app-markdown-split">
  <MarkdownEditor
    value={source()}
    onValueChange={setSource}
    aria-label="Release notes Markdown"
    fill
  />

  <section aria-label="Release notes preview">
    <MarkdownView html={html()} />
  </section>
</div>
```
