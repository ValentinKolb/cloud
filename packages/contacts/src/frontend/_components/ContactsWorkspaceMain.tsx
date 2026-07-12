import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { AppWorkspace, Pagination } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import type { Contact, ContactTag } from "../../service";
import ContactTagChip from "./ContactTagChip";
import ContactsList from "./ContactsList.island";
import CreateContactButton from "./CreateContactButton.island";

type ContactBookOption = {
  id: string;
  name: string;
};

type Props = {
  title: string;
  description: string;
  total: number;
  search: string;
  searchAction: string;
  searchPlaceholder: string;
  contacts: Contact[];
  bookNames: Record<string, string>;
  showBookNames?: boolean;
  initialSelectedContactId: string | null;
  initialSelectedBookId: string | null;
  writableBooks: ContactBookOption[];
  defaultCreateBookId: string | null;
  chooseBookOnCreate?: boolean;
  currentPage: number;
  totalPages: number;
  paginationBaseUrl: string;
  tags?: ContactTag[];
  activeTagId?: string | null;
  filtersBasePath?: string;
};

const filterHref = (basePath: string, search: string, tagId?: string) => {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (tagId) params.set("tag_id", tagId);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
};

export default function ContactsWorkspaceMain(props: Props) {
  const resultCopy = props.search.trim()
    ? `${props.total} result${props.total === 1 ? "" : "s"} for “${props.search.trim()}”`
    : `${props.total} contact${props.total === 1 ? "" : "s"}`;
  const tags = props.tags ?? [];

  return (
    <AppWorkspace.Main>
      <header class="flex shrink-0 flex-col gap-3 px-3 py-3 sm:px-4">
        <div class="flex min-w-0 items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="truncate text-base font-semibold text-primary">{props.title}</h1>
            <p class="mt-0.5 truncate text-xs text-dimmed">
              <span class="tabular-nums text-secondary">{resultCopy}</span>
              <span aria-hidden="true"> · </span>
              {props.description}
            </p>
          </div>
          <CreateContactButton
            writableBooks={props.writableBooks}
            defaultBookId={props.defaultCreateBookId}
            chooseBook={props.chooseBookOnCreate}
            buttonClass="btn-primary btn-sm shrink-0 lg:hidden"
            label="New contact"
          />
        </div>

        <SearchBar
          action={props.searchAction}
          value={props.search}
          placeholder={props.searchPlaceholder}
          ariaLabel={`Filter ${props.title}`}
        />

        <Show when={tags.length > 0 && props.filtersBasePath}>
          <nav aria-label="Filter contacts by tag" class="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
            <a
              href={filterHref(props.filtersBasePath!, props.search)}
              aria-current={!props.activeTagId ? "page" : undefined}
              class={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs font-medium transition-colors ${
                props.activeTagId
                  ? "border-[var(--ui-border)] bg-[var(--ui-surface-muted)] text-secondary hover:bg-[var(--ui-hover)]"
                  : "border-transparent bg-[var(--ui-selected)] text-primary"
              }`}
            >
              All
            </a>
            {tags.map((tag) => (
              <a
                href={filterHref(props.filtersBasePath!, props.search, tag.id)}
                aria-current={props.activeTagId === tag.id ? "page" : undefined}
                class="inline-flex shrink-0 transition-opacity hover:opacity-80"
              >
                <ContactTagChip name={tag.name} color={tag.color} active={props.activeTagId === tag.id} size="sm" />
              </a>
            ))}
          </nav>
        </Show>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto border-t border-[var(--ui-divider)]" data-scroll-preserve="contacts-main-list">
        <ContactsList
          contacts={props.contacts}
          bookNames={props.bookNames}
          showBookNames={props.showBookNames}
          initialSelectedContactId={props.initialSelectedContactId}
          initialSelectedBookId={props.initialSelectedBookId}
          emptyTitle={props.search.trim() ? "No matching contacts" : "No contacts yet"}
          emptyDescription={
            props.search.trim()
              ? "Try a different name, company, email address, or phone number."
              : "Create the first contact from the action above."
          }
        />
      </div>

      <Show when={props.totalPages > 1}>
        <div class="shrink-0 border-t border-[var(--ui-divider)] px-3 py-2">
          <Pagination currentPage={props.currentPage} totalPages={props.totalPages} baseUrl={props.paginationBaseUrl} />
        </div>
      </Show>
    </AppWorkspace.Main>
  );
}
