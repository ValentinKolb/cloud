import { Link, type LinkNavigateEvent } from "@k2b/ssr/nav";
import { createMemo, For, type JSX, Show } from "solid-js";

export type PaginationProps = {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
};

type PaginationLinkProps = {
  href: string;
  label: string;
  rel?: "prev" | "next";
  class?: string;
  onNavigate?: PaginationProps["onNavigate"];
  children: JSX.Element;
};

const PaginationLink = (props: PaginationLinkProps) =>
  props.onNavigate ? (
    <Link
      href={props.href}
      rel={props.rel}
      scroll="top"
      onNavigate={props.onNavigate}
      class={`k2b-pagination__page ${props.class ?? ""}`}
      aria-label={props.label}
    >
      {props.children}
    </Link>
  ) : (
    <a href={props.href} rel={props.rel} class={`k2b-pagination__page ${props.class ?? ""}`} aria-label={props.label}>
      {props.children}
    </a>
  );

/** Link-based pagination with directional navigation and compact mobile disclosure. */
export const Pagination = (props: PaginationProps): null | JSX.Element => {
  if (props.totalPages <= 1) return null;

  const href = (page: number) => `${props.baseUrl}${page}`;
  const visiblePages = createMemo(() =>
    Array.from({ length: props.totalPages }, (_, index) => index + 1).filter(
      (page) => page === 1 || page === props.totalPages || Math.abs(page - props.currentPage) <= 1,
    ),
  );

  return (
    <nav class="k2b-pagination" aria-label="Pagination">
      <span class="k2b-sr-only">
        Page {props.currentPage} of {props.totalPages}
      </span>
      <div class="k2b-pagination__pages">
        <Show when={props.currentPage > 1}>
          <PaginationLink href={href(props.currentPage - 1)} rel="prev" label="Previous page" onNavigate={props.onNavigate}>
            <i class="ti ti-chevron-left" aria-hidden="true" />
          </PaginationLink>
        </Show>

        <For each={visiblePages()}>
          {(page, index) => {
            const previousPage = () => visiblePages()[index() - 1];
            const hasGap = () => previousPage() !== undefined && page - previousPage()! > 1;
            const isCurrent = () => page === props.currentPage;
            const mobileVisible = () => page === 1 || page === props.totalPages || isCurrent();

            return (
              <>
                <Show when={hasGap()}>
                  <span class="k2b-pagination__ellipsis" aria-hidden="true">
                    …
                  </span>
                </Show>
                <Show
                  when={isCurrent()}
                  fallback={
                    <PaginationLink
                      href={href(page)}
                      label={`Page ${page}`}
                      class={mobileVisible() ? "" : "k2b-pagination__page--wide-only"}
                      onNavigate={props.onNavigate}
                    >
                      {page}
                    </PaginationLink>
                  }
                >
                  <span class="k2b-pagination__page is-current" aria-current="page">
                    {page}
                  </span>
                </Show>
              </>
            );
          }}
        </For>

        <Show when={props.currentPage < props.totalPages}>
          <PaginationLink href={href(props.currentPage + 1)} rel="next" label="Next page" onNavigate={props.onNavigate}>
            <i class="ti ti-chevron-right" aria-hidden="true" />
          </PaginationLink>
        </Show>
      </div>
    </nav>
  );
};
