import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { ContactBook } from "../../service";
import ContactsSpotlightButton from "./ContactsSpotlightButton.island";
import CreateBookButton from "./CreateBookButton.island";

type Props = {
  books: ContactBook[];
  active: "all" | string;
  adminBookIds?: string[];
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
        active={isActive}
        title={book.name}
        viewTransitionName={vt(`book-${book.id}-${mode}`)}
        class="w-full"
      >
        <AppWorkspace.SidebarItemIcon icon={icon} />
        <AppWorkspace.SidebarItemLabel>{book.name}</AppWorkspace.SidebarItemLabel>
      </AppWorkspace.SidebarItem>
    );
  };

  return (
    <AppWorkspace.Sidebar collapsible>
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
        <div data-sidebar-mode="expanded" style={`view-transition-name:${vt("primary-actions-desktop")}`}>
          <ContactsSpotlightButton variant="sidebar" registerShortcut />
        </div>
        <AppWorkspace.SidebarIconGrid sidebarMode="collapsed">
          <ContactsSpotlightButton variant="icon" />
          <CreateBookButton variant="icon" label="New book" />
        </AppWorkspace.SidebarIconGrid>

        <AppWorkspace.SidebarBody scrollPreserveKey="contacts-sidebar">
          <AppWorkspace.SidebarSection>
            <AppWorkspace.SidebarItem
              href="/app/contacts"
              navigation="document"
              icon="ti ti-users"
              active={props.active === "all"}
              title="All contacts"
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
                <AppWorkspace.SidebarItem
                  href={href}
                  navigation="document"
                  active={isActive}
                  viewTransitionName={vt(`book-${book.id}-desktop`)}
                  title={book.name}
                >
                  <AppWorkspace.SidebarItemIcon icon="ti ti-address-book" />
                  <AppWorkspace.SidebarItemLabel>{book.name}</AppWorkspace.SidebarItemLabel>
                  {canManage && (
                    <AppWorkspace.SidebarItemAction
                      href={`/app/contacts/${book.id}/settings`}
                      navigation="document"
                      icon="ti ti-settings"
                      label={`Open settings for ${book.name}`}
                    />
                  )}
                </AppWorkspace.SidebarItem>
              );
            })}
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarSection title="Directory">
            {systemBooks.map((book) => renderBookItem(book, "desktop"))}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>

        <AppWorkspace.SidebarFooter sidebarMode="expanded">
          <CreateBookButton buttonClass="btn-simple btn-sm w-full justify-start text-dimmed" label="New book" />
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
