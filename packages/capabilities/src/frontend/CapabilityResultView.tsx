import { CopyButton, Disclosure, IconButtonLink, Placeholder, StructuredDataPreview } from "@k2b/ui";
import type {
  CapabilityPage,
  CapabilitySemanticLink,
  CloudResourceRef,
  CloudResourceView,
  UniversalSearchData,
} from "@valentinkolb/cloud/contracts";
import { For, Show } from "solid-js";
import type { SelectedCapability } from "../catalog";
import { resolveCapabilityDataPresentation } from "../result-presentation";

const linkIcon = (link: CapabilitySemanticLink): string => {
  if (link.rel === "edit") return "ti ti-pencil";
  if (link.rel === "download") return "ti ti-download";
  if (link.rel === "preview") return "ti ti-eye";
  if (link.rel === "status") return "ti ti-activity";
  return "ti ti-arrow-up-right";
};

const linkLabel = (link: CapabilitySemanticLink): string => {
  if (link.title) return link.title;
  if (link.rel === "edit") return "Edit";
  if (link.rel === "download") return "Download";
  if (link.rel === "preview") return "Preview";
  if (link.rel === "status") return "View status";
  return "Open";
};

const primaryLink = (item: CloudResourceView): CapabilitySemanticLink =>
  item.links.find((link) => link.rel === "open") ??
  item.links.find((link) => link.rel === "preview") ??
  item.links.find((link) => link.rel === "edit") ??
  item.links[0]!;

function SearchResultRow(props: { item: CloudResourceView }) {
  const primary = primaryLink(props.item);
  const secondaryLinks = props.item.links.filter((link) => link !== primary);

  return (
    <li class="group flex min-w-0 items-start gap-3 py-2">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-dimmed">
        <i class={`${props.item.icon ?? "ti ti-cube"} text-base`} aria-hidden="true" />
      </span>

      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <div class="min-w-0">
            <a href={primary.href} class="block truncate text-sm font-semibold text-primary transition-colors group-hover:app-accent-text">
              {props.item.title}
            </a>
            <Show when={props.item.preview}>
              {(preview) => <p class="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-secondary">{preview()}</p>}
            </Show>
          </div>
          <IconButtonLink href={primary.href} class="shrink-0" size="sm" label={`${linkLabel(primary)} ${props.item.title}`}>
            <i class={linkIcon(primary)} aria-hidden="true" />
          </IconButtonLink>
        </div>

        <Show when={props.item.metadata?.length}>
          <dl class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <For each={props.item.metadata}>
              {(entry) => (
                <div class="flex min-w-0 gap-1">
                  <dt class="text-dimmed">{entry.label}</dt>
                  <dd class="max-w-64 truncate text-secondary" title={entry.value}>
                    {entry.value}
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </Show>

        <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-dimmed">
          <code class="min-w-0 truncate" title={`${props.item.ref.type}:${props.item.ref.id}`}>
            {props.item.ref.type} · {props.item.ref.id}
          </code>
          <CopyButton
            text={`${props.item.ref.type}:${props.item.ref.id}`}
            class="focus-ui inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] transition-colors hover:bg-[var(--ui-hover)] hover:text-secondary"
          />
          <For each={secondaryLinks}>
            {(link) => (
              <a href={link.href} class="inline-flex items-center gap-1 text-secondary transition-colors hover:app-accent-text">
                <i class={linkIcon(link)} aria-hidden="true" />
                {linkLabel(link)}
              </a>
            )}
          </For>
        </div>
      </div>
    </li>
  );
}

function UniversalSearchResults(props: { items: UniversalSearchData }) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Results</h3>
        <span class="text-xs tabular-nums text-dimmed">
          {props.items.length} {props.items.length === 1 ? "resource" : "resources"}
        </span>
      </div>

      <Show
        when={props.items.length > 0}
        fallback={
          <Placeholder
            icon="ti ti-search-off"
            title="No results"
            description="The query completed successfully but found no matching resources."
          />
        }
      >
        <ul class="flex flex-col gap-1">
          <For each={props.items}>{(item) => <SearchResultRow item={item} />}</For>
        </ul>
      </Show>

      <Disclosure summary="Raw result data" icon="ti ti-braces">
        <StructuredDataPreview data={props.items} defaultMode="raw" />
      </Disclosure>
    </div>
  );
}

function ResourceReferences(props: { refs: CloudResourceRef[] }) {
  return (
    <div class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Resource references</h3>
      <div class="flex flex-col gap-1">
        <For each={props.refs}>
          {(ref) => (
            <div class="detail-row min-w-0">
              <i class="ti ti-cube detail-row-icon" aria-hidden="true" />
              <code class="min-w-0 flex-1 truncate text-[11px] text-secondary" title={`${ref.type}:${ref.id}`}>
                {ref.type} · {ref.id}
              </code>
              <CopyButton text={`${ref.type}:${ref.id}`} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function PageSummary(props: { page: CapabilityPage }) {
  return (
    <div class="flex items-start gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2.5">
      <i class={`ti ${props.page.hasMore ? "ti-list-details" : "ti-check"} mt-0.5 text-dimmed`} aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium text-secondary">{props.page.hasMore ? "More results are available" : "This is the final page"}</p>
        <Show when={props.page.hasMore ? props.page.nextCursor : undefined}>
          {(cursor) => <code class="mt-0.5 block truncate text-[10px] text-dimmed">Cursor: {cursor()}</code>}
        </Show>
      </div>
      <Show when={props.page.hasMore ? props.page.nextCursor : undefined}>
        {(cursor) => <CopyButton text={cursor()} label="Copy cursor" />}
      </Show>
    </div>
  );
}

function SemanticLinks(props: { links: CapabilitySemanticLink[] }) {
  return (
    <div class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Links</h3>
      <div class="flex flex-col gap-1">
        <For each={props.links}>
          {(link) => (
            <a href={link.href} class="detail-row group min-w-0 transition-colors hover:bg-[var(--ui-hover)]">
              <i class={`${linkIcon(link)} detail-row-icon`} aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-medium text-secondary transition-colors group-hover:app-accent-text">
                  {linkLabel(link)}
                </span>
                <span class="block truncate text-[10px] text-dimmed" title={link.href}>
                  {link.href}
                </span>
              </span>
              <i class="ti ti-arrow-up-right text-dimmed" aria-hidden="true" />
            </a>
          )}
        </For>
      </div>
    </div>
  );
}

export default function CapabilityResultView(props: {
  selection: SelectedCapability;
  data: unknown;
  refs?: CloudResourceRef[];
  page?: CapabilityPage;
  links?: CapabilitySemanticLink[];
}) {
  const presentation = () => resolveCapabilityDataPresentation(props.selection, props.data);
  const searchItems = () => {
    const resolved = presentation();
    return resolved.kind === "universal-search" ? resolved.items : undefined;
  };

  return (
    <div class="flex flex-col gap-4">
      <Show
        when={searchItems()}
        fallback={<StructuredDataPreview title="Data" data={props.data} empty="The capability returned no data." />}
      >
        {(items) => <UniversalSearchResults items={items()} />}
      </Show>
      <Show when={props.refs}>{(refs) => refs().length > 0 && <ResourceReferences refs={refs()} />}</Show>
      <Show when={props.page}>{(page) => <PageSummary page={page()} />}</Show>
      <Show when={props.links}>{(links) => links().length > 0 && <SemanticLinks links={links()} />}</Show>
    </div>
  );
}
