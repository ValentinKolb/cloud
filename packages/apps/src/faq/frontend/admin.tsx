import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { faqService } from "../service";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import FaqForm from "./_components/FaqForm.island";
import FaqDelete from "./_components/FaqDelete.island";
import FaqReorder from "./_components/FaqReorder.island";
import type { FaqAudience } from "@/faq/contracts";

const AUDIENCE_LABELS: Record<FaqAudience, { label: string; color: string }> = {
  user: {
    label: "User",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  guest: {
    label: "Guest",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  anonymous: {
    label: "Not signed in",
    color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

export default ssr<AuthContext>(async (c) => {
  const entries = (await faqService.entry.list()).items;
  const allIds = entries.map((e) => e.id);

  return (
    <AdminLayout c={c} title="FAQ">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">FAQ Management</h1>
          <FaqForm />
        </div>

        <div class="info-block-info p-4 text-xs flex items-start gap-2">
          <i class="ti ti-info-circle shrink-0 mt-0.5" />
          <p>
            Manage the FAQ entries shown to users on the help page. Each entry can be targeted to specific audiences (users, guests,
            or anonymous visitors). Use the arrow buttons to reorder entries — the order here matches the display order on the public
            page. Questions and answers support plain text.
          </p>
        </div>

        {entries.length > 0 ? (
          <div class="flex flex-col gap-2">
            {entries.map((entry, index) => (
              <div class="paper p-4 flex gap-3 items-start">
                <FaqReorder allIds={allIds} index={index} />

                <div class="flex-1 min-w-0">
                  <h3 class="font-medium text-sm">{entry.question}</h3>
                  <p class="text-xs text-dimmed mt-1 line-clamp-2">{entry.answer}</p>
                  <div class="flex flex-wrap gap-1 mt-2">
                    {entry.audience.map((a) => {
                      const info = AUDIENCE_LABELS[a];
                      return <span class={`px-1.5 py-0.5 rounded text-[10px] font-medium ${info.color}`}>{info.label}</span>;
                    })}
                  </div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <FaqForm id={entry.id} question={entry.question} answer={entry.answer} audience={entry.audience} />
                  <FaqDelete id={entry.id} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">No FAQ entries yet. Click "New FAQ" to create one.</div>
        )}
      </div>
    </AdminLayout>
  );
});
