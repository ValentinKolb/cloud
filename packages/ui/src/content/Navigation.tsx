import { For, type JSX, Show } from "solid-js";

export type PaginationProps = {
  currentPage: number;
  totalPages: number;
  href: (page: number) => string;
  label?: string;
  class?: string;
};

const pageWindow = (current: number, total: number): number[] => {
  const values = new Set([1, total, current - 1, current, current + 1]);
  return [...values].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
};

export function Pagination(props: PaginationProps): JSX.Element {
  const pages = () => pageWindow(props.currentPage, Math.max(1, props.totalPages));
  return (
    <Show when={props.totalPages > 1}>
      <nav class={`k2b-pagination ${props.class ?? ""}`} aria-label={props.label ?? "Pagination"}>
        <span class="k2b-visually-hidden">
          Page {props.currentPage} of {props.totalPages}
        </span>
        <Show when={props.currentPage > 1}>
          <a class="k2b-pagination__edge" href={props.href(props.currentPage - 1)} rel="prev" aria-label="Previous page">
            <i class="ti ti-chevron-left" aria-hidden="true" />
            <span>Previous</span>
          </a>
        </Show>
        <span class="k2b-pagination__pages">
          <For each={pages()}>
            {(page, index) => (
              <>
                <Show when={index() > 0 && page - (pages()[index() - 1] ?? page) > 1}>
                  <span aria-hidden="true">…</span>
                </Show>
                <Show
                  when={page !== props.currentPage}
                  fallback={
                    <span class="k2b-pagination__page is-current" aria-current="page">
                      {page}
                    </span>
                  }
                >
                  <a class="k2b-pagination__page" href={props.href(page)} aria-label={`Page ${page}`}>
                    {page}
                  </a>
                </Show>
              </>
            )}
          </For>
        </span>
        <Show when={props.currentPage < props.totalPages}>
          <a class="k2b-pagination__edge" href={props.href(props.currentPage + 1)} rel="next" aria-label="Next page">
            <span>Next</span>
            <i class="ti ti-chevron-right" aria-hidden="true" />
          </a>
        </Show>
      </nav>
    </Show>
  );
}

export type RangeOption<T extends string = string> = { value: T; label?: string; href: string };
export type RangePickerProps<T extends string = string> = {
  value: T;
  options: readonly RangeOption<T>[];
  label?: string | null;
  ariaLabel?: string;
  class?: string;
};

export function RangePicker<T extends string = string>(props: RangePickerProps<T>): JSX.Element {
  const caption = () => (props.label === null ? undefined : (props.label ?? "Window"));
  return (
    <nav class={`k2b-range-picker ${props.class ?? ""}`} aria-label={props.ariaLabel ?? caption() ?? "Range"}>
      <Show when={caption()}>
        {(label) => <span>{label()}</span>}
      </Show>
      <For each={props.options}>
        {(option) => (
          <a href={option.href} aria-current={option.value === props.value ? "page" : undefined}>
            {option.label ?? option.value}
          </a>
        )}
      </For>
    </nav>
  );
}
