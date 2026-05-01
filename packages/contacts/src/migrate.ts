import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS contacts`.simple();
  console.log("  ✓ contacts schema");

  await sql`
    CREATE TABLE IF NOT EXISTS contacts.books (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ contacts.books table");

  await sql`
    CREATE TABLE IF NOT EXISTS contacts.book_access (
      book_id UUID NOT NULL REFERENCES contacts.books(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (book_id, access_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_book_access_access
    ON contacts.book_access(access_id)
  `.simple();
  console.log("  ✓ contacts.book_access table");

  await sql`
    CREATE TABLE IF NOT EXISTS contacts.contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      book_id UUID NOT NULL REFERENCES contacts.books(id) ON DELETE CASCADE,
      label TEXT,
      first_name TEXT,
      last_name TEXT,
      company_name TEXT,
      department TEXT,
      job_title TEXT,
      vat_id TEXT,
      website TEXT,
      birthday DATE,
      note TEXT,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contacts_book
    ON contacts.contacts(book_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contacts_book_label
    ON contacts.contacts(book_id, label)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contacts_vat_id
    ON contacts.contacts(vat_id)
    WHERE vat_id IS NOT NULL
  `.simple();
  console.log("  ✓ contacts.contacts table");

  await sql`
    CREATE TABLE IF NOT EXISTS contacts.contact_emails (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts.contacts(id) ON DELETE CASCADE,
      label TEXT,
      email TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (contact_id, position)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contact_emails_contact
    ON contacts.contact_emails(contact_id)
  `.simple();
  console.log("  ✓ contacts.contact_emails table");

  await sql`
    CREATE TABLE IF NOT EXISTS contacts.contact_phones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts.contacts(id) ON DELETE CASCADE,
      label TEXT,
      phone TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (contact_id, position)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contact_phones_contact
    ON contacts.contact_phones(contact_id)
  `.simple();
  console.log("  ✓ contacts.contact_phones table");

  await sql`
    CREATE TABLE IF NOT EXISTS contacts.contact_addresses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts.contacts(id) ON DELETE CASCADE,
      label TEXT,
      recipient_name TEXT,
      company_name TEXT,
      line1 TEXT NOT NULL,
      line2 TEXT,
      postal_code TEXT NOT NULL,
      city TEXT NOT NULL,
      state_region TEXT,
      country_code CHAR(2) NOT NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (contact_id, position)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contact_addresses_contact
    ON contacts.contact_addresses(contact_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contact_addresses_postal
    ON contacts.contact_addresses(postal_code, city)
  `.simple();
  console.log("  ✓ contacts.contact_addresses table");

  // Hierarchy: parent_contact_id introduced after initial release. ON DELETE SET NULL
  // keeps children intact when a parent is deleted; cycles are prevented at the
  // service layer via a recursive CTE check, not in the schema.
  await sql`
    ALTER TABLE contacts.contacts
    ADD COLUMN IF NOT EXISTS parent_contact_id UUID NULL
    REFERENCES contacts.contacts(id) ON DELETE SET NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_contacts_contacts_parent
    ON contacts.contacts(parent_contact_id)
    WHERE parent_contact_id IS NOT NULL
  `.simple();
  console.log("  ✓ contacts.contacts.parent_contact_id column + index");
};
