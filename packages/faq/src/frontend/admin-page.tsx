import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";
import { faqService } from "../service";
import CreateFaqButton from "./_components/CreateFaqButton.island";
import EditFaqButton from "./_components/EditFaqButton.island";
import DeleteFaqButton from "./_components/DeleteFaqButton.island";

const AUDIENCE_LABELS: Record<string, string> = {
  anonymous: "Anonymous",
  guest: "Guests",
  user: "Users",
};

const AUDIENCE_BADGE: Record<string, string> = {
  anonymous: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  guest: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  user: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

export default ssr<AuthContext>(async (c) => {
  const entries = (await faqService.entry.list()).items;

  return () => (
    <AdminLayout c={c} title="FAQ" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-3" style="view-transition-name: admin-faq-toolbar">
            <div class="min-w-0">
              <h1 class="text-base font-semibold text-primary">FAQ</h1>
              <p class="mt-1 text-xs text-dimmed">
                {entries.length} {entries.length === 1 ? "entry" : "entries"} — visible at <code class="text-[10px]">/faq</code>
              </p>
            </div>
            <CreateFaqButton />
          </div>

          {entries.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-faq-list">
              <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
                {entries.map((entry) => (
                  <div class="flex flex-col gap-2 px-3 py-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="text-sm font-medium text-primary">{entry.question}</h3>
                          {entry.audience.map((aud) => (
                            <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${AUDIENCE_BADGE[aud] ?? AUDIENCE_BADGE.user}`}>
                              {AUDIENCE_LABELS[aud] ?? aud}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-1">
                        <EditFaqButton entry={entry} />
                        <DeleteFaqButton id={entry.id} question={entry.question} />
                      </div>
                    </div>
                    <div class="text-sm text-dimmed pl-0">
                      <MarkdownView html={markdown.render(entry.answer)} class="markdown-content-sm" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">
              No FAQ entries yet. Click <span class="font-medium text-primary">New Entry</span> to create the first one.
            </section>
          )}
        </div>
      </div>
    </AdminLayout>
  );
});
