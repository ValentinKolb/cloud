export function AssistantMarkdownBlock(props: { html: string }) {
  return <div class="assistant-markdown-block" innerHTML={props.html} />;
}
