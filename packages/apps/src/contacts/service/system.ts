import { sql } from "bun";
import { paginate, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";
import { emptyToNull, isUuid, toPgUuidArray } from "./shared";
import type { Contact, ContactAddress, ContactBook, ContactEmail, ContactPhone } from "./types";

export const SYSTEM_BOOK_ID = "system";

const SYSTEM_BOOK: ContactBook = {
  id: SYSTEM_BOOK_ID,
  name: "System (IPA)",
  description: "Read-only contacts projected from synced FreeIPA users.",
  isSystem: true,
  createdAt: null,
  updatedAt: null,
};

type DbSystemUser = {
  id: string;
  uid: string;
  display_name: string;
  given_name: string;
  sn: string;
  mail: string | null;
  phone: string | null;
  mobile: string | null;
  employee_type: string | null;
  addr_street: string | null;
  addr_postal_code: string | null;
  addr_city: string | null;
  addr_state: string | null;
  created_at: Date;
  synced_at: Date | null;
};

/**
 * Marks whether a requested book ID points to the virtual IPA system book.
 */
export const isSystemBookId = (bookId: string): boolean => bookId === SYSTEM_BOOK_ID;

/**
 * Returns metadata for the virtual system book.
 */
export const getSystemBook = (): ContactBook => SYSTEM_BOOK;

const mapSystemEmails = (row: DbSystemUser): ContactEmail[] => {
  if (!row.mail) return [];

  return [
    {
      id: `${row.id}:email:0`,
      contactId: row.id,
      label: "work",
      email: row.mail,
      position: 0,
      createdAt: row.created_at.toISOString(),
      updatedAt: (row.synced_at ?? row.created_at).toISOString(),
    },
  ];
};

const mapSystemPhones = (row: DbSystemUser): ContactPhone[] => {
  const values = [
    row.phone ? { label: "phone", phone: row.phone } : null,
    row.mobile ? { label: "mobile", phone: row.mobile } : null,
  ].filter((value): value is { label: string; phone: string } => value !== null);

  return values.map((value, index) => ({
    id: `${row.id}:phone:${index}`,
    contactId: row.id,
    label: value.label,
    phone: value.phone,
    position: index,
    createdAt: row.created_at.toISOString(),
    updatedAt: (row.synced_at ?? row.created_at).toISOString(),
  }));
};

const mapSystemAddresses = (row: DbSystemUser): ContactAddress[] => {
  if (!row.addr_street || !row.addr_postal_code || !row.addr_city) return [];

  return [
    {
      id: `${row.id}:address:0`,
      contactId: row.id,
      label: "work",
      recipientName: emptyToNull(row.display_name) ?? row.uid,
      companyName: null,
      line1: row.addr_street,
      line2: null,
      postalCode: row.addr_postal_code,
      city: row.addr_city,
      stateRegion: emptyToNull(row.addr_state),
      countryCode: "DE",
      position: 0,
      createdAt: row.created_at.toISOString(),
      updatedAt: (row.synced_at ?? row.created_at).toISOString(),
    },
  ];
};

/**
 * Maps one synced IPA user into a read-only contact projection.
 */
const mapSystemContact = (row: DbSystemUser): Contact => ({
  id: row.id,
  bookId: SYSTEM_BOOK_ID,
  displayName: emptyToNull(row.display_name) ?? row.uid,
  firstName: emptyToNull(row.given_name),
  lastName: emptyToNull(row.sn),
  companyName: null,
  department: emptyToNull(row.employee_type),
  jobTitle: null,
  vatId: null,
  website: null,
  birthday: null,
  note: null,
  source: "ipa",
  createdAt: row.created_at.toISOString(),
  updatedAt: (row.synced_at ?? row.created_at).toISOString(),
  emails: mapSystemEmails(row),
  phones: mapSystemPhones(row),
  addresses: mapSystemAddresses(row),
});

const buildSearchPattern = (query: string | undefined): string | null => {
  const trimmed = query?.trim().toLowerCase();
  if (!trimmed) return null;
  return `%${trimmed}%`;
};

/**
 * Lists read-only system contacts with optional search and pagination.
 */
export const listSystemContacts = async (config: { pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<Contact>> => {
  const searchPattern = buildSearchPattern(config.filter?.query);
  const { page, perPage, offset } = paginate(config.pagination);

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM auth.users u
    LEFT JOIN auth.user_ipa_data d ON d.user_id = u.id
    WHERE u.provider = 'ipa'
      AND (
        ${searchPattern}::text IS NULL
        OR LOWER(u.uid) LIKE ${searchPattern}
        OR LOWER(u.display_name) LIKE ${searchPattern}
        OR LOWER(u.given_name) LIKE ${searchPattern}
        OR LOWER(u.sn) LIKE ${searchPattern}
        OR LOWER(COALESCE(u.mail, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.phone, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.mobile, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.employee_type, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.addr_street, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.addr_postal_code, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.addr_city, '')) LIKE ${searchPattern}
      )
  `;

  const rows = await sql<DbSystemUser[]>`
    SELECT
      u.id,
      u.uid,
      u.display_name,
      u.given_name,
      u.sn,
      u.mail,
      d.phone,
      d.mobile,
      d.employee_type,
      d.addr_street,
      d.addr_postal_code,
      d.addr_city,
      d.addr_state,
      u.created_at,
      d.synced_at
    FROM auth.users u
    LEFT JOIN auth.user_ipa_data d ON d.user_id = u.id
    WHERE u.provider = 'ipa'
      AND (
        ${searchPattern}::text IS NULL
        OR LOWER(u.uid) LIKE ${searchPattern}
        OR LOWER(u.display_name) LIKE ${searchPattern}
        OR LOWER(u.given_name) LIKE ${searchPattern}
        OR LOWER(u.sn) LIKE ${searchPattern}
        OR LOWER(COALESCE(u.mail, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.phone, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.mobile, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.employee_type, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.addr_street, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.addr_postal_code, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(d.addr_city, '')) LIKE ${searchPattern}
      )
    ORDER BY LOWER(COALESCE(NULLIF(u.display_name, ''), u.uid)) ASC
    LIMIT ${perPage}
    OFFSET ${offset}
  `;

  const total = countRow?.count ?? 0;
  return {
    items: rows.map(mapSystemContact),
    page,
    perPage,
    total,
    hasNext: page * perPage < total,
  };
};

/**
 * Returns one read-only IPA contact by user UUID.
 */
export const getSystemContact = async (config: { id: string }): Promise<Contact | null> => {
  if (!isUuid(config.id)) return null;

  const [row] = await sql<DbSystemUser[]>`
    SELECT
      u.id,
      u.uid,
      u.display_name,
      u.given_name,
      u.sn,
      u.mail,
      d.phone,
      d.mobile,
      d.employee_type,
      d.addr_street,
      d.addr_postal_code,
      d.addr_city,
      d.addr_state,
      u.created_at,
      d.synced_at
    FROM auth.users u
    LEFT JOIN auth.user_ipa_data d ON d.user_id = u.id
    WHERE u.id = ${config.id}::uuid
      AND u.provider = 'ipa'
  `;

  return row ? mapSystemContact(row) : null;
};

/**
 * Loads multiple system contacts by UUID and returns an ID-indexed lookup map.
 */
export const getSystemContactsByIds = async (ids: string[]): Promise<Map<string, Contact>> => {
  const validIds = ids.filter(isUuid);
  if (validIds.length === 0) return new Map();

  const rows = await sql<DbSystemUser[]>`
    SELECT
      u.id,
      u.uid,
      u.display_name,
      u.given_name,
      u.sn,
      u.mail,
      d.phone,
      d.mobile,
      d.employee_type,
      d.addr_street,
      d.addr_postal_code,
      d.addr_city,
      d.addr_state,
      u.created_at,
      d.synced_at
    FROM auth.users u
    LEFT JOIN auth.user_ipa_data d ON d.user_id = u.id
    WHERE u.id = ANY(${toPgUuidArray(validIds)}::uuid[])
      AND u.provider = 'ipa'
  `;

  const mapped = new Map<string, Contact>();
  for (const row of rows) {
    mapped.set(row.id, mapSystemContact(row));
  }
  return mapped;
};
