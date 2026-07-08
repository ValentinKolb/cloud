import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

const StartTab = () => (
  <DocPage>
    <DocLead>
      Contacts keeps manual address books with structured contact records, tags, notes, hierarchy links, and book-level access.
    </DocLead>

    <DocSection title="Overview" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "Contact book",
            icon: "ti-cube",
            text: "A manual address book with its own tags, permissions, API keys, import, export, and deletion settings.",
          },
          {
            title: "Contact",
            icon: "ti-id",
            text: "One person, company, supplier, customer, or other party with contact points, addresses, work data, personal data, and bank details.",
          },
          {
            title: "Tags",
            icon: "ti-tags",
            text: "Book-specific labels for filtering and grouping contacts.",
          },
          {
            title: "Detail panel",
            icon: "ti-layout-sidebar-right",
            text: "The working view for reading details, editing a contact, adding notes, moving the contact, and managing members.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <DocRows
        items={[
          {
            title: "Choose a book",
            icon: "ti-address-book",
            text: "Open one book when you need its tags. Use All Contacts to search across readable manual books.",
          },
          {
            title: "Create the contact",
            icon: "ti-user-plus",
            text: "Start with the name and the contact points people use first: email, phone, website, or address.",
          },
          {
            title: "Add structure",
            icon: "ti-tags",
            text: "Add tags, work details, personal details, bank details, notes, or a parent contact when they help later lookup.",
          },
          {
            title: "Open details",
            icon: "ti-layout-sidebar-right",
            text: "Select a contact to view the detail panel, edit the record, add notes, move it, or manage member links.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="System contacts" variant="info">
      The system book projects IPA directory contacts and is read-only. All Contacts searches manual books; open the system book directly to
      browse system contacts.
    </DocNote>
  </DocPage>
);

const HierarchyTab = () => (
  <DocPage>
    <DocLead>
      Contact hierarchy links records inside the same manual book when one contact belongs under another.
    </DocLead>

    <DocSection title="How hierarchy works">
      <DocRows
        items={[
          {
            title: "Belongs to",
            icon: "ti-corner-down-right",
            text: "The contact editor has an optional parent field. Setting it makes the contact a member of that parent.",
          },
          {
            title: "Members",
            icon: "ti-users",
            text: "A parent contact shows its direct members in the detail panel. You can add a member from the parent contact when you can edit the book.",
          },
          {
            title: "Tree",
            icon: "ti-hierarchy",
            text: "The Tree action loads the top-most parent and all descendants for the selected contact, independent of the current page of results.",
          },
          {
            title: "Same book",
            icon: "ti-cube",
            text: "Parent and member contacts must live in the same manual book. Moving a contact removes links that would cross books.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Rules to remember">
      <DocRows
        items={[
          {
            title: "No cycles",
            icon: "ti-ban",
            text: "A contact cannot be its own parent, and the server rejects hierarchy cycles.",
          },
          {
            title: "Link only",
            icon: "ti-unlink",
            text: "Removing a member only removes the parent link. The contact itself stays in the book.",
          },
          {
            title: "Read-only limits",
            icon: "ti-lock",
            text: "Read-only and system contacts can be viewed, but member links can only be changed in writable manual books.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Use hierarchy sparingly" variant="tip">
      Use hierarchy for durable membership. Use tags for loose categories that can overlap.
    </DocNote>
  </DocPage>
);

const BooksTab = () => (
  <DocPage>
    <DocLead>
      Contact book settings control metadata, tags, access, API keys, import, export, and deletion for one manual book.
    </DocLead>

    <DocSection title="Book settings">
      <DocRows
        items={[
          {
            title: "General",
            icon: "ti-id",
            text: "Rename the book and maintain its optional description.",
          },
          {
            title: "Tags",
            icon: "ti-tags",
            text: "Manage the tag vocabulary for this book. Tags are assigned from the contact editor.",
          },
          {
            title: "Access",
            icon: "ti-shield",
            text: "Grant read, write, or admin access to users and groups. Permission changes save immediately.",
          },
          {
            title: "API keys",
            icon: "ti-key",
            text: "Create resource-bound keys for integrations that need access to this contact book.",
          },
          {
            title: "Import & export",
            icon: "ti-arrows-exchange",
            text: "Preview and import vCard contacts, or export the book as vCard or CSV. These actions are restricted to book admins.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Access levels">
      Read access lets people view contacts. Write access lets them create and update contacts. Admin access adds book settings, sharing,
      tag management, import, export, and deletion.
    </DocNote>
  </DocPage>
);

export default function ContactsLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="contacts-start"
        title="Start"
        icon="ti ti-address-book"
        description="Contact books, records, tags, system contacts, and the detail workflow."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="contacts-hierarchy"
        title="Hierarchy"
        icon="ti ti-hierarchy"
        description="Belongs-to links, members, tree view, and hierarchy rules."
        order={110}
      >
        <HierarchyTab />
      </Layout.Help>
      <Layout.Help
        id="contacts-books-sharing"
        title="Books & access"
        icon="ti ti-lock"
        description="Book settings, access, API keys, tags, import, export, and deletion."
        order={120}
      >
        <BooksTab />
      </Layout.Help>
    </>
  );
}
