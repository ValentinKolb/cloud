import { CopyButton, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { MetricsToken } from "../service";

type Props = {
  tokens: MetricsToken[];
};

type CreateResponse =
  | {
      token: string;
      credential: MetricsToken;
    }
  | { message: string };

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message ?? fallback;
  } catch {
    return fallback;
  }
};

const formatDate = (value: string | null): string => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const TokenDialog = (props: { token: string }) => (
  <div class="flex flex-col gap-3">
    <p class="text-xs text-dimmed">Store this bearer token now. It is shown once and cannot be recovered later.</p>
    <div class="rounded-md bg-zinc-100 p-3 dark:bg-zinc-800">
      <code class="block break-all text-[11px] text-primary">{props.token}</code>
    </div>
    <div class="flex justify-end">
      <CopyButton text={props.token} label="Copy token" class="btn-primary btn-sm" />
    </div>
  </div>
);

export default function MetricsTokens(props: Props) {
  const createMutation = mutations.create<{ token: string; credential: MetricsToken }, { name: string; expiresAt: string | null }>({
    mutation: async (input) => {
      const response = await fetch("/api/gateway/metrics/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as CreateResponse;
      if (!response.ok || !("token" in data)) throw new Error("message" in data ? data.message : "Failed to create metrics token.");
      return data;
    },
    onSuccess: async (data) => {
      await prompts.dialog(() => <TokenDialog token={data.token} />, {
        title: "Metrics token created",
        icon: "ti ti-key",
      });
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const revokeMutation = mutations.create<void, MetricsToken>({
    mutation: async (token) => {
      const response = await fetch(`/api/gateway/metrics/tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to revoke metrics token."));
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (error) => prompts.error(error.message),
  });

  const createToken = async () => {
    const result = await prompts.form({
      title: "Create metrics token",
      icon: "ti ti-key",
      confirmText: "Create",
      fields: {
        name: {
          type: "text" as const,
          label: "Token name",
          description: "Shown in the token list so admins can identify the scraper using it.",
          default: "Pulse metrics scrape",
          required: true,
        },
        expires_at: {
          type: "datetime" as const,
          label: "Expiry",
          description: "Optional expiry. Leave empty for a non-expiring token.",
        },
      },
    });
    if (!result) return;
    await createMutation.mutate({
      name: String(result.name ?? "").trim(),
      expiresAt: String(result.expires_at ?? "").trim() || null,
    });
  };

  const revokeToken = async (token: MetricsToken) => {
    const confirmed = await prompts.confirm(`Revoke "${token.name}"? Scrapers using this bearer token will fail immediately.`, {
      title: "Revoke metrics token",
      icon: "ti ti-key-off",
      confirmText: "Revoke",
      variant: "danger",
    });
    if (!confirmed) return;
    await revokeMutation.mutate(token);
  };

  return (
    <section class="paper overflow-hidden">
      <div class="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
        <div class="min-w-0">
          <h2 class="text-xs font-semibold text-primary">Bearer tokens</h2>
          <p class="text-[10px] text-dimmed">Resource-bound service account tokens with the metrics:read scope.</p>
        </div>
        <button type="button" class="btn-primary btn-sm ml-auto" onClick={createToken} disabled={createMutation.loading()}>
          <i class={createMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
          New token
        </button>
      </div>
      {props.tokens.length > 0 ? (
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-dimmed dark:border-zinc-800/60">
              <tr>
                <th class="px-3 py-2 font-medium">Name</th>
                <th class="px-3 py-2 font-medium">Prefix</th>
                <th class="px-3 py-2 font-medium">Scope</th>
                <th class="px-3 py-2 font-medium">Expires</th>
                <th class="px-3 py-2 font-medium">Last used</th>
                <th class="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {props.tokens.map((token) => (
                <tr class="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/60">
                  <td class="px-3 py-2 font-medium text-primary">{token.name}</td>
                  <td class="px-3 py-2 font-mono text-[11px] text-secondary">{token.tokenPrefix}</td>
                  <td class="px-3 py-2">
                    <span class="tag bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      {token.scopes.join(", ") || "-"}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-dimmed">{formatDate(token.expiresAt)}</td>
                  <td class="px-3 py-2 text-dimmed">{formatDate(token.lastUsedAt)}</td>
                  <td class="px-3 py-2 text-right">
                    <button
                      type="button"
                      class="btn-danger btn-sm"
                      onClick={() => revokeToken(token)}
                      disabled={revokeMutation.loading()}
                      title="Revoke token"
                    >
                      <i class={revokeMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-key-off"} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="px-3 py-8 text-center text-xs text-dimmed">No metrics bearer tokens yet.</div>
      )}
    </section>
  );
}
