import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { termsService } from "../service";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import TermsForm from "./_components/TermsForm.island";
import TermsDelete from "./_components/TermsDelete.island";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default ssr<AuthContext>(async (c) => {
  const versions = (await termsService.version.list()).items;

  return (
    <AdminLayout c={c} title="Terms">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">Terms of Service</h1>
          <TermsForm />
        </div>

        <div class="info-block-info p-4 text-xs flex items-start gap-2">
          <i class="ti ti-info-circle shrink-0 mt-0.5" />
          <p>
            Manage the terms of service that users must accept. Each new version is stored separately — the latest version is always the
            active one.
          </p>
        </div>

        {versions.length > 0 ? (
          <div class="flex flex-col gap-2">
            {versions.map((version, index) => (
              <div class="paper p-4 flex gap-3 items-start">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">{formatDate(version.createdAt)}</span>
                    {index === 0 && (
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-medium leading-none bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                        Latest
                      </span>
                    )}
                  </div>
                  <p class="text-xs text-dimmed mt-1 line-clamp-3 whitespace-pre-line">
                    {version.content.slice(0, 300)}
                    {version.content.length > 300 ? "..." : ""}
                  </p>
                  <a
                    href={`/legal/agb?v=${version.id}`}
                    class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1 mt-2"
                    target="_blank"
                  >
                    <i class="ti ti-external-link text-[10px]" />
                    View
                  </a>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <TermsDelete id={version.id} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">No terms versions yet. Click "New Version" to create one.</div>
        )}
      </div>
    </AdminLayout>
  );
});
