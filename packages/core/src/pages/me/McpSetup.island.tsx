import { CopyButton } from "@k2b/ui";
import { createMcpSetupSnippets } from "./mcp-setup";

const Snippet = (props: { label: string; value: string }) => (
  <div>
    <div class="mb-1.5 flex items-center justify-between gap-3">
      <span class="text-xs font-medium text-secondary">{props.label}</span>
      <CopyButton text={props.value} label={`Copy ${props.label}`} size="xs" />
    </div>
    <pre class="overflow-x-auto rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2 font-mono text-xs text-secondary">
      <code>{props.value}</code>
    </pre>
  </div>
);

export default function McpSetup(props: { endpoint: string }) {
  const snippets = createMcpSetupSnippets(props.endpoint);

  return (
    <div class="flex flex-col gap-4">
      <Snippet label="Endpoint" value={snippets.endpoint} />
      <Snippet label="Codex with API key" value={snippets.codexApiKey} />
      <Snippet label="Claude Code with API key" value={snippets.claudeApiKey} />
      <Snippet label="Codex with preregistered OAuth client" value={snippets.codexOAuth} />
      <Snippet label="Claude Code with preregistered OAuth client" value={snippets.claudeOAuth} />
    </div>
  );
}
