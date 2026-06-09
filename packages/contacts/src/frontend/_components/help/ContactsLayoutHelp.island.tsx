import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

const StartTab = () => (
  <DocPage>
    <DocLead>
      Contacts keeps people, companies, contact points, notes, and book-specific organization in one address book workspace. Use it when the
      contact record itself is the source of truth.
    </DocLead>

    <DocSection title="Mental model" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "Contact book",
            icon: "ti-cube",
            text: "A shared address book with its own access rules, tags, import, and export settings.",
          },
          {
            title: "Contact",
            icon: "ti-id",
            text: "One person, company, supplier, customer, or other party with reach, address, work, personal, and bank details.",
          },
          {
            title: "Tags",
            icon: "ti-tags",
            text: "Book-specific labels for grouping contacts, such as VIP, Lead, Supplier, or Billing.",
          },
          {
            title: "Detail panel",
            icon: "ti-layout-sidebar-right",
            text: "The working view for contact details, notes, member links, edit actions, and moving contacts between writable books.",
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
            text: "Open one contact book when you need its tags and permissions. Use All Contacts for a broad manual-contact search.",
          },
          {
            title: "Create the contact",
            icon: "ti-user-plus",
            text: "Start with the name and the contact points people need first: email, phone, website, or address.",
          },
          {
            title: "Add structure",
            icon: "ti-tags",
            text: "Assign tags, work details, personal details, bank details, and notes only when they help later lookup or action.",
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
      System contact books can appear in the sidebar, but system contacts are read-only. Manual contact books are where users create, edit,
      tag, import, and export contacts.
    </DocNote>
  </DocPage>
);

const HierarchyTab = () => (
  <DocPage>
    <DocLead>
      Contact hierarchy links contacts inside the same book. Use it for company-to-person, organization-to-team, household, or membership
      relationships where one contact belongs under another.
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
            text: "Parent and member contacts must live in the same manual contact book. Moving a contact removes parent/member links that would cross books.",
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
      Use hierarchy for durable relationships. Use tags for loose categories that can overlap, such as VIP, Lead, Supplier, or Billing.
    </DocNote>
  </DocPage>
);

const BooksTab = () => (
  <DocPage>
    <DocLead>
      Contact books define who can see or maintain a set of contacts. Book admins manage metadata, tags, access, import, export, and
      deletion.
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
            title: "Import & export",
            icon: "ti-arrows-exchange",
            text: "Import contacts from vCard, or export the book as vCard or CSV. These actions are restricted to book admins.",
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
        title="Start: Contacts"
        icon="ti ti-address-book"
        description="Contact books, records, tags, and the detail workflow."
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
        title="Books & Sharing"
        icon="ti ti-lock"
        description="Book settings, access, tags, import, and export."
        order={120}
      >
        <BooksTab />
      </Layout.Help>
    </>
  );
}
