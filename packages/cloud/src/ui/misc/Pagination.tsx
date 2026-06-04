import type { JSX } from "solid-js";
import { Link, type LinkNavigateEvent } from "@valentinkolb/ssr/nav";

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
};

/**
 * Renders pagination controls with ellipsis for large page counts.
 * Shows first, last, and pages adjacent to current page.
 */
export const Pagination = (props: PaginationProps): null | JSX.Element => {
  if (props.totalPages <= 1) return null;

  const visiblePages = Array.from({ length: props.totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === props.totalPages || Math.abs(p - props.currentPage) <= 1,
  );

  return (
    <nav class="flex items-center justify-center gap-0.5 pt-3" aria-label="Pagination">
      {visiblePages.map((page, idx) => {
        const prevPage = visiblePages[idx - 1];
        const shouldShowEllipsis = prevPage && page - prevPage > 1;
        const isActive = page === props.currentPage;

        return (
          <>
            {shouldShowEllipsis && (
              <span class="flex h-7 w-7 items-center justify-center text-dimmed text-xs select-none" aria-hidden="true">
                ...
              </span>
            )}
            {props.onNavigate ? (
              <Link
                href={`${props.baseUrl}${page}`}
                scroll="top"
                onNavigate={props.onNavigate}
                class={`flex h-7 w-7 items-center justify-center rounded-lg text-xs tabular-nums transition-colors ${
                  isActive
                    ? "border-blue-500/35 bg-blue-50 text-blue-700 font-medium dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200"
                    : "text-dimmed hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                aria-current={isActive ? "page" : undefined}
                aria-label={`Page ${page}`}
              >
                {page}
              </Link>
            ) : (
              <a
                href={`${props.baseUrl}${page}`}
                class={`flex h-7 w-7 items-center justify-center rounded-lg text-xs tabular-nums transition-colors ${
                  isActive
                    ? "border-blue-500/35 bg-blue-50 text-blue-700 font-medium dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200"
                    : "text-dimmed hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                aria-current={isActive ? "page" : undefined}
                aria-label={`Page ${page}`}
              >
                {page}
              </a>
            )}
          </>
        );
      })}
    </nav>
  );
};
