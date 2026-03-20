import type { ContactBook } from "../../service";
import CreateContactButton from "./CreateContactButton.island";
import CreateBookButton from "./CreateBookButton.island";

type ContactBookOption = {
  id: string;
  name: string;
};

type Props = {
  books: ContactBook[];
  active: "all" | string;
  adminBookIds?: string[];
  writableBooks: ContactBookOption[];
  defaultCreateBookId?: string | null;
};

/**
 * Contacts sidebar with books and quick create actions.
 */
export default function ContactsSidebar(props: Props) {
  const adminBookIds = props.adminBookIds ?? [];
  const manualBooks = props.books.filter((book) => !book.isSystem);
  const systemBooks = props.books.filter((book) => book.isSystem);
  const vt = (key: string) => `contacts-sidebar-${key}`;

  return (
    <>
      <nav class="sidebar-container-mobile">
        <details class="group">
          <summary class="sidebar-mobile-toggle">
            <div class="w-8 h-8 rounded-lg bg-blue-500 text-white grid place-items-center shrink-0">
              <i class="ti ti-address-book text-sm" />
            </div>
            <span class="font-semibold truncate flex-1">Contacts</span>
            <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
              <i class="ti ti-chevron-down text-sm" />
            </span>
          </summary>
          <div class="sidebar-mobile-actions">
            <CreateContactButton
              writableBooks={props.writableBooks}
              defaultBookId={props.defaultCreateBookId ?? null}
              buttonClass="sidebar-item-mobile btn-success btn-sm"
              label="Create Contact"
            />
            <CreateBookButton buttonClass="sidebar-item-mobile" label="New Book" />
            <a
              href="/app/contacts"
              class={`sidebar-item-mobile ${props.active === "all" ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200" : ""}`}
              aria-current={props.active === "all" ? "page" : undefined}
              style={`view-transition-name:${vt("all-mobile")}`}
            >
              <i class="ti ti-users" />
              All Contacts
            </a>
            {manualBooks.map((book) => {
              const href = `/app/contacts/${book.id}`;
              const isActive = props.active === book.id;
              return (
                <a
                  href={href}
                  class={`sidebar-item-mobile ${isActive ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  style={`view-transition-name:${vt(`book-${book.id}-mobile`)}`}
                >
                  <i class={`ti ${book.isSystem ? "ti-building-community" : "ti-address-book"}`} />
                  {book.name}
                </a>
              );
            })}
            {systemBooks.map((book) => {
              const href = `/app/contacts/${book.id}`;
              const isActive = props.active === book.id;
              return (
                <a
                  href={href}
                  class={`sidebar-item-mobile ${isActive ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  style={`view-transition-name:${vt(`book-${book.id}-mobile`)}`}
                >
                  <i class="ti ti-building-community" />
                  {book.name}
                </a>
              );
            })}
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="paper flex h-full min-h-0 flex-col gap-4 p-4">
          <div class="flex items-center gap-3">
            <div class="sidebar-header-icon bg-blue-500">
              <i class="ti ti-address-book text-xs" />
            </div>
            <p class="sidebar-header-title">Contacts</p>
          </div>

          <div class="flex flex-col gap-3">
            <section class="sidebar-group">
              <p class="sidebar-section-title">Actions</p>
              <CreateContactButton
                writableBooks={props.writableBooks}
                defaultBookId={props.defaultCreateBookId ?? null}
                buttonClass="sidebar-item w-full text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20"
                label="Create Contact"
              />
            </section>

            <section class="sidebar-group">
              <p class="sidebar-section-title">Contacts</p>
              <a
                href="/app/contacts"
                class={`sidebar-item ${props.active === "all" ? "sidebar-item-active" : ""}`}
                aria-current={props.active === "all" ? "page" : undefined}
                style={`view-transition-name:${vt("all-desktop")}`}
              >
                <i class="ti ti-users text-sm" />
                <span class="truncate">All Contacts</span>
              </a>

              {manualBooks.map((book) => {
                const href = `/app/contacts/${book.id}`;
                const isActive = props.active === book.id;
                const canManage = adminBookIds.includes(book.id);
                return (
                  <div class={`sidebar-item group ${isActive ? "sidebar-item-active" : ""}`} style={`view-transition-name:${vt(`book-${book.id}-desktop`)}`}>
                    <a href={href} class="flex min-w-0 flex-1 items-center gap-2" aria-current={isActive ? "page" : undefined}>
                      <i class={`ti ${book.isSystem ? "ti-building-community" : "ti-address-book"} text-sm`} />
                      <span class="truncate">{book.name}</span>
                    </a>
                    {canManage && (
                      <a
                        href={`/app/contacts/${book.id}/settings`}
                        class="sidebar-item-action opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        aria-label={`Open settings for ${book.name}`}
                        title="Book settings"
                      >
                        <i class="ti ti-settings text-xs" />
                      </a>
                    )}
                  </div>
                );
              })}

              {systemBooks.map((book) => {
                const href = `/app/contacts/${book.id}`;
                const isActive = props.active === book.id;
                return (
                  <a
                    href={href}
                    class={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    style={`view-transition-name:${vt(`book-${book.id}-desktop`)}`}
                  >
                    <i class="ti ti-building-community text-sm" />
                    <span class="truncate">{book.name}</span>
                  </a>
                );
              })}
            </section>
          </div>

          <div class="sidebar-footer">
            <CreateBookButton buttonClass="sidebar-item w-full" label="New Book" />
          </div>
        </div>
      </aside>
    </>
  );
}
