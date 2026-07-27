# Markdown content

`MarkdownView` renders trusted, pre-rendered HTML with shared prose styles. `MarkdownEditor` owns interactive Markdown editing. The caller owns the Markdown source, HTML rendering, sanitization policy, and persistence.

## Use Markdown content

Use `MarkdownView` for notes, descriptions, comments, help, and generated content whose source is Markdown.

Use `MarkdownEditor` when the same surface also edits Markdown. Use the editor's dedicated component page for its full completion, save, and input API.

## Import

```tsx
import { markdown } from "@valentinkolb/cloud/shared";
import {
  MarkdownEditor,
  MarkdownView,
} from "@valentinkolb/cloud/ui";
```

## Render Markdown

`MarkdownView` expects HTML, not Markdown:

```tsx
const html = markdown.render(markdownSource);

<MarkdownView html={html} />;
```

It writes `html` into the document and does not parse or sanitize it itself. Use the shared Markdown renderer, or pass HTML that has already been processed under an equivalent trusted policy.

The component does not impose a reading width. The parent owns width, scrolling, and surrounding layout.

Set `smallHeadings` for compact embedded content such as comments or table details. Use `class` for context-specific text sizing.

## Editing and preview

Keep the Markdown string as the source of truth. Derive preview HTML from that string instead of trying to reconstruct Markdown from rendered HTML.

For a live client preview, use `markdown.renderSync(value())` in a memo and pass the result to `MarkdownView`. Saving still belongs to the parent mutation or form.

## Accessibility

Rendered Markdown must preserve a useful heading order and descriptive link text. Do not use `smallHeadings` to repair an incorrect document structure.

Give standalone editors an `ariaLabel` when no visible label references them. Preview and edit modes need visible names when both are present.

## Runtime

`MarkdownView` is server-renderable and needs no hydration for ordinary HTML. Mermaid and other optional client enhancements require the shared Markdown client initializer in a hydrated host.

`MarkdownEditor` and a reactive live preview require hydration. The initial preview can still be rendered on the server from the initial Markdown value.

## Example

```tsx
const [source, setSource] = createSignal("# Release notes");
const html = createMemo(() => markdown.renderSync(source()));

<div class="grid gap-4 lg:grid-cols-2">
  <MarkdownEditor
    value={source}
    onInput={setSource}
    ariaLabel="Release notes Markdown"
    fill
  />

  <section aria-label="Release notes preview">
    <MarkdownView html={html()} />
  </section>
</div>
```
