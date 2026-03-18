import type { Context } from "hono";
import type { User } from "@valentinkolb/cloud/contracts/shared";
import { hasRole } from "@valentinkolb/cloud/contracts/shared";
import { quotesService } from "./service";
import type { Widget } from "@valentinkolb/cloud/contracts/app";

/**
 * Create quote widget.
 * Only shown for logged-in users (not guests).
 */
export async function createQuoteWidget(c: Context, user?: User): Promise<Widget> {
  // Not for guests or unauthenticated users
  if (!user || hasRole(user, "guest")) return null;

  const quoteResult = await quotesService.quote.get();
  if (!quoteResult.ok) return null;
  const quote = quoteResult.data;

  return {
    id: "quote",
    title: "Quote of the Hour",
    icon: "quote",
    content: (
      <div class="flex flex-col justify-center flex-1 text-sm relative">
        <i class="ti ti-quote text-6xl text-zinc-200 dark:text-zinc-700 absolute -top-2 -left-1" />
        <blockquote class="text-secondary italic relative z-10 leading-relaxed">{quote.text}</blockquote>
        <p class="text-xs text-dimmed mt-3 flex items-center gap-1.5">
          <span class="w-8 h-px bg-zinc-300 dark:bg-zinc-600" />
          {quote.author}
        </p>
      </div>
    ),
  };
}
