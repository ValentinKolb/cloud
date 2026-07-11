import { Link, type LinkNavigateEvent } from "@valentinkolb/ssr/nav";
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
      class={`pagination-item ${props.class ?? ""}`}
      aria-label={props.label}
    >
      {props.children}
    </Link>
  ) : (
    <a href={props.href} rel={props.rel} class={`pagination-item ${props.class ?? ""}`} aria-label={props.label}>
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
    <nav class="max-w-full overflow-x-auto pt-3" aria-label="Pagination">
      <span class="sr-only">
        Page {props.currentPage} of {props.totalPages}
      </span>
      <div class="mx-auto flex w-max items-center gap-1">
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
                  <span class="pagination-ellipsis hidden sm:flex" aria-hidden="true">
                    …
                  </span>
                </Show>
                <Show
                  when={isCurrent()}
                  fallback={
                    <PaginationLink
                      href={href(page)}
                      label={`Page ${page}`}
                      class={mobileVisible() ? "" : "hidden sm:inline-flex"}
                      onNavigate={props.onNavigate}
                    >
                      {page}
                    </PaginationLink>
                  }
                >
                  <span class="pagination-item pagination-item-current" aria-current="page">
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
