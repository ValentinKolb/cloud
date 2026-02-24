import { ssr } from "@valentinkolb/cloud/core/config";
import { termsService } from "../service";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { MarkdownView } from "@valentinkolb/cloud/lib/ui";
import { markdown } from "@valentinkolb/cloud/lib/shared";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export default ssr(async (c) => {
  const versionId = c.req.query("v");
  const showHistory = c.req.query("history") === "true";

  // History view
  if (showHistory) {
    const versions = (await termsService.version.list()).items;
    return (
      <Layout c={c} title="Terms of Service">
        <div class="container max-w-3xl p-4 sm:p-8">
          <h1 class="text-xl font-bold mb-4">Terms of Service — Version History</h1>

          <a href="/legal/agb" class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1 mb-6">
            <i class="ti ti-arrow-left text-[10px]" />
            Back to current version
          </a>

          {versions.length > 0 ? (
            <div class="flex flex-col gap-2">
              {versions.map((version, index) => (
                <a
                  href={`/legal/agb?v=${version.id}`}
                  class="paper p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center gap-3"
                >
                  <i class="ti ti-file-text text-dimmed" />
                  <div class="flex-1 min-w-0">
                    <span class="text-sm font-medium">{formatDate(version.createdAt)}</span>
                    {index === 0 && (
                      <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                        Latest
                      </span>
                    )}
                  </div>
                  <i class="ti ti-chevron-right text-dimmed text-xs" />
                </a>
              ))}
            </div>
          ) : (
            <div class="paper p-6 text-center text-sm text-dimmed">No terms versions available.</div>
          )}
        </div>
      </Layout>
    );
  }

  // Single version view (specific or latest)
  const latestVersion = await termsService.version.latest();
  const version = versionId ? await termsService.version.get({ id: versionId }) : latestVersion;

  if (!version) {
    return (
      <Layout c={c} title="Terms of Service">
        <div class="container max-w-3xl p-4 sm:p-8">
          <h1 class="text-xl font-bold mb-4">Terms of Service</h1>
          <div class="paper p-6 text-center text-sm text-dimmed">No terms of service available yet.</div>
        </div>
      </Layout>
    );
  }

  const isLatest = !latestVersion || version.id === latestVersion.id;
  const html = markdown.render(version.content);

  return (
    <Layout c={c} title="Terms of Service">
      <div class="container max-w-3xl p-4 sm:p-8">
        {!isLatest && (
          <div class="info-block-warning mb-4">
            You are viewing an older version of the Terms of Service.{" "}
            <a href="/legal/agb" class="underline font-medium">
              View the current version
            </a>
          </div>
        )}

        <div class="flex items-center justify-between mb-6">
          <div class="text-xs text-dimmed">Published: {formatDate(version.createdAt)}</div>
          <a href="/legal/agb?history=true" class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1">
            <i class="ti ti-history text-[10px]" />
            Version history
          </a>
        </div>

        <MarkdownView html={html} />
      </div>
    </Layout>
  );
});
