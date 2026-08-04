import { CopyButton } from "@k2b/ui";

const Snippet = (props: { label: string; value: string }) => (
  <div>
    <div class="mb-1.5 flex items-center justify-between gap-3">
      <span class="text-xs font-medium text-secondary">{props.label}</span>
      <CopyButton text={props.value} label="Copy" size="xs" />
    </div>
    <pre class="overflow-x-auto rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2 font-mono text-xs text-secondary">
      <code>{props.value}</code>
    </pre>
  </div>
);

export default function McpSetup(props: { endpoint: string; resource: string }) {
  const codexConfig = `[mcp_servers.cloud]\nurl = "${props.endpoint}"\nbearer_token_env_var = "CLOUD_API_KEY"\noauth_resource = "${props.resource}"\nscopes = ["read", "write"]`;
  const claudeCommand = `claude mcp add --transport http --scope user cloud ${props.endpoint} --header "Authorization: Bearer <personal-api-key>"`;

  return (
    <div class="flex flex-col gap-4">
      <Snippet label="Endpoint" value={props.endpoint} />
      <Snippet label="Codex config.toml" value={codexConfig} />
      <Snippet label="Claude Code" value={claudeCommand} />
    </div>
  );
}
