import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { ContactBook } from "../../service";
import ContactsSpotlightButton from "./ContactsSpotlightButton.island";
import CreateBookButton from "./CreateBookButton.island";
import CreateContactButton from "./CreateContactButton.island";

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
  const renderBookItem = (book: ContactBook, mode: "mobile" | "desktop") => {
    const href = `/app/contacts/${book.id}`;
    const isActive = props.active === book.id;
    const icon = book.isSystem ? "ti ti-building-community" : "ti ti-address-book";

    return (
      <AppWorkspace.SidebarItem
        href={href}
        navigation="document"
        icon={icon}
        active={isActive}
        viewTransitionName={vt(`book-${book.id}-${mode}`)}
        class="w-full"
      >
        {book.name}
      </AppWorkspace.SidebarItem>
    );
  };

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader
        title="Contacts"
        icon="ti ti-address-book"
        iconStyle="background-color: var(--app-accent)"
        showDesktop={false}
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          <ContactsSpotlightButton variant="sidebar-mobile" />
          <CreateBookButton buttonClass="sidebar-item-mobile" label="New book" />
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="contacts-sidebar-mobile">
          <AppWorkspace.SidebarSection>
            <AppWorkspace.SidebarItem
              href="/app/contacts"
              navigation="document"
              icon="ti ti-users"
              active={props.active === "all"}
              viewTransitionName={vt("all-mobile")}
            >
              All contacts
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Books">
            {manualBooks.map((book) => renderBookItem(book, "mobile"))}
          </AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Directory">
            {systemBooks.map((book) => renderBookItem(book, "mobile"))}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <div class="flex flex-col gap-2" style={`view-transition-name:${vt("primary-actions-desktop")}`}>
          <CreateContactButton
            writableBooks={props.writableBooks}
            defaultBookId={props.defaultCreateBookId ?? null}
            chooseBook={props.active === "all" || !props.defaultCreateBookId}
            buttonClass="btn-primary btn-sm w-full justify-start"
            label="New contact"
          />
          <ContactsSpotlightButton variant="sidebar" registerShortcut />
        </div>

        <AppWorkspace.SidebarBody scrollPreserveKey="contacts-sidebar">
          <AppWorkspace.SidebarSection>
            <AppWorkspace.SidebarItem
              href="/app/contacts"
              navigation="document"
              icon="ti ti-users"
              active={props.active === "all"}
              viewTransitionName={vt("all-desktop")}
            >
              All contacts
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarSection title="Books">
            {manualBooks.map((book) => {
              const href = `/app/contacts/${book.id}`;
              const isActive = props.active === book.id;
              const canManage = adminBookIds.includes(book.id);
              return (
                <div
                  class={`sidebar-item group text-xs ${isActive ? "sidebar-item-active" : ""}`}
                  style={`view-transition-name:${vt(`book-${book.id}-desktop`)}`}
                >
                  <a href={href} class="flex min-w-0 flex-1 items-center gap-2" aria-current={isActive ? "page" : undefined}>
                    <i class="ti ti-address-book text-sm" />
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
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarSection title="Directory">
            {systemBooks.map((book) => renderBookItem(book, "desktop"))}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>

        <AppWorkspace.SidebarFooter class="border-t border-[var(--ui-divider)] pt-2">
          <CreateBookButton buttonClass="btn-simple btn-sm w-full justify-start text-dimmed" label="New book" />
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
