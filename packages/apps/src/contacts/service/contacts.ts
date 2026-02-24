import { sql } from "bun";
import { err, fail, ok, paginate, type PageParams, type Paginated, type Result } from "@valentinkolb/cloud/lib/server";
import { getSystemContact, getSystemContactsByIds, isSystemBookId, listSystemContacts, SYSTEM_BOOK_ID } from "./system";
import { emptyToNull, isUuid, toDateOnly, toPgTextArray, toPgUuidArray } from "./shared";
import type {
  Contact,
  ContactAddress,
  ContactAddressInput,
  ContactEmail,
  ContactEmailInput,
  ContactPhone,
  ContactPhoneInput,
  CreateContactInput,
  UpdateContactInput,
} from "./types";

type DbContact = {
  id: string;
  book_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  department: string | null;
  job_title: string | null;
  vat_id: string | null;
  website: string | null;
  birthday: Date | string | null;
  note: string | null;
  source: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbEmail = {
  id: string;
  contact_id: string;
  label: string | null;
  email: string;
  position: number;
  created_at: Date;
  updated_at: Date;
};

type DbPhone = {
  id: string;
  contact_id: string;
  label: string | null;
  phone: string;
  position: number;
  created_at: Date;
  updated_at: Date;
};

type DbAddress = {
  id: string;
  contact_id: string;
  label: string | null;
  recipient_name: string | null;
  company_name: string | null;
  line1: string;
  line2: string | null;
  postal_code: string;
  city: string;
  state_region: string | null;
  country_code: string;
  position: number;
  created_at: Date;
  updated_at: Date;
};

type SearchRow = {
  contact_id: string;
  book_id: string;
  source_kind: "manual" | "system";
};

/**
 * Converts one manual contact row into API shape with supplied child rows.
 */
const mapContact = (config: { row: DbContact; emails: ContactEmail[]; phones: ContactPhone[]; addresses: ContactAddress[] }): Contact => ({
  id: config.row.id,
  bookId: config.row.book_id,
  displayName: config.row.display_name,
  firstName: config.row.first_name,
  lastName: config.row.last_name,
  companyName: config.row.company_name,
  department: config.row.department,
  jobTitle: config.row.job_title,
  vatId: config.row.vat_id,
  website: config.row.website,
  birthday: toDateOnly(config.row.birthday),
  note: config.row.note,
  source: config.row.source,
  createdAt: config.row.created_at.toISOString(),
  updatedAt: config.row.updated_at.toISOString(),
  emails: config.emails,
  phones: config.phones,
  addresses: config.addresses,
});

const mapEmail = (row: DbEmail): ContactEmail => ({
  id: row.id,
  contactId: row.contact_id,
  label: row.label,
  email: row.email,
  position: row.position,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapPhone = (row: DbPhone): ContactPhone => ({
  id: row.id,
  contactId: row.contact_id,
  label: row.label,
  phone: row.phone,
  position: row.position,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapAddress = (row: DbAddress): ContactAddress => ({
  id: row.id,
  contactId: row.contact_id,
  label: row.label,
  recipientName: row.recipient_name,
  companyName: row.company_name,
  line1: row.line1,
  line2: row.line2,
  postalCode: row.postal_code,
  city: row.city,
  stateRegion: row.state_region,
  countryCode: row.country_code,
  position: row.position,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const buildSearchPattern = (query: string | undefined): string | null => {
  const trimmed = query?.trim().toLowerCase();
  if (!trimmed) return null;
  return `%${trimmed}%`;
};

const loadEmails = async (contactIds: string[]): Promise<Map<string, ContactEmail[]>> => {
  const validIds = contactIds.filter(isUuid);
  if (validIds.length === 0) return new Map();

  const rows = await sql<DbEmail[]>`
    SELECT id, contact_id, label, email, position, created_at, updated_at
    FROM contacts.contact_emails
    WHERE contact_id = ANY(${toPgUuidArray(validIds)}::uuid[])
    ORDER BY position ASC, created_at ASC
  `;

  const grouped = new Map<string, ContactEmail[]>();
  for (const row of rows) {
    grouped.set(row.contact_id, [...(grouped.get(row.contact_id) ?? []), mapEmail(row)]);
  }
  return grouped;
};

const loadPhones = async (contactIds: string[]): Promise<Map<string, ContactPhone[]>> => {
  const validIds = contactIds.filter(isUuid);
  if (validIds.length === 0) return new Map();

  const rows = await sql<DbPhone[]>`
    SELECT id, contact_id, label, phone, position, created_at, updated_at
    FROM contacts.contact_phones
    WHERE contact_id = ANY(${toPgUuidArray(validIds)}::uuid[])
    ORDER BY position ASC, created_at ASC
  `;

  const grouped = new Map<string, ContactPhone[]>();
  for (const row of rows) {
    grouped.set(row.contact_id, [...(grouped.get(row.contact_id) ?? []), mapPhone(row)]);
  }
  return grouped;
};

const loadAddresses = async (contactIds: string[]): Promise<Map<string, ContactAddress[]>> => {
  const validIds = contactIds.filter(isUuid);
  if (validIds.length === 0) return new Map();

  const rows = await sql<DbAddress[]>`
    SELECT
      id,
      contact_id,
      label,
      recipient_name,
      company_name,
      line1,
      line2,
      postal_code,
      city,
      state_region,
      country_code,
      position,
      created_at,
      updated_at
    FROM contacts.contact_addresses
    WHERE contact_id = ANY(${toPgUuidArray(validIds)}::uuid[])
    ORDER BY position ASC, created_at ASC
  `;

  const grouped = new Map<string, ContactAddress[]>();
  for (const row of rows) {
    grouped.set(row.contact_id, [...(grouped.get(row.contact_id) ?? []), mapAddress(row)]);
  }
  return grouped;
};

/**
 * Loads manual contacts by IDs and hydrates all child subtables.
 */
export const getManualContactsByIds = async (ids: string[]): Promise<Map<string, Contact>> => {
  const validIds = ids.filter(isUuid);
  if (validIds.length === 0) return new Map();

  const rows = await sql<DbContact[]>`
    SELECT
      id,
      book_id,
      display_name,
      first_name,
      last_name,
      company_name,
      department,
      job_title,
      vat_id,
      website,
      birthday,
      note,
      source,
      created_at,
      updated_at
    FROM contacts.contacts
    WHERE id = ANY(${toPgUuidArray(validIds)}::uuid[])
  `;

  const contactIds = rows.map((row) => row.id);
  const [emailsByContact, phonesByContact, addressesByContact] = await Promise.all([
    loadEmails(contactIds),
    loadPhones(contactIds),
    loadAddresses(contactIds),
  ]);

  const mapped = new Map<string, Contact>();
  for (const row of rows) {
    mapped.set(
      row.id,
      mapContact({
        row,
        emails: emailsByContact.get(row.id) ?? [],
        phones: phonesByContact.get(row.id) ?? [],
        addresses: addressesByContact.get(row.id) ?? [],
      }),
    );
  }

  return mapped;
};

const replaceEmails = async (contactId: string, emails: ContactEmailInput[]): Promise<void> => {
  await sql`
    DELETE FROM contacts.contact_emails
    WHERE contact_id = ${contactId}::uuid
  `;

  for (const [index, email] of emails.entries()) {
    await sql`
      INSERT INTO contacts.contact_emails (
        contact_id,
        label,
        email,
        position
      ) VALUES (
        ${contactId}::uuid,
        ${emptyToNull(email.label) ?? null},
        ${email.email.trim()},
        ${index}
      )
    `;
  }
};

const replacePhones = async (contactId: string, phones: ContactPhoneInput[]): Promise<void> => {
  await sql`
    DELETE FROM contacts.contact_phones
    WHERE contact_id = ${contactId}::uuid
  `;

  for (const [index, phone] of phones.entries()) {
    await sql`
      INSERT INTO contacts.contact_phones (
        contact_id,
        label,
        phone,
        position
      ) VALUES (
        ${contactId}::uuid,
        ${emptyToNull(phone.label) ?? null},
        ${phone.phone.trim()},
        ${index}
      )
    `;
  }
};

const replaceAddresses = async (contactId: string, addresses: ContactAddressInput[]): Promise<void> => {
  await sql`
    DELETE FROM contacts.contact_addresses
    WHERE contact_id = ${contactId}::uuid
  `;

  for (const [index, address] of addresses.entries()) {
    await sql`
      INSERT INTO contacts.contact_addresses (
        contact_id,
        label,
        recipient_name,
        company_name,
        line1,
        line2,
        postal_code,
        city,
        state_region,
        country_code,
        position
      ) VALUES (
        ${contactId}::uuid,
        ${emptyToNull(address.label) ?? null},
        ${emptyToNull(address.recipientName) ?? null},
        ${emptyToNull(address.companyName) ?? null},
        ${address.line1.trim()},
        ${emptyToNull(address.line2) ?? null},
        ${address.postalCode.trim()},
        ${address.city.trim()},
        ${emptyToNull(address.stateRegion) ?? null},
        ${address.countryCode.trim().toUpperCase()},
        ${index}
      )
    `;
  }
};

const mapManualSearchCondition = (searchPattern: string | null) => sql`
  (
    ${searchPattern}::text IS NULL
    OR LOWER(c.display_name) LIKE ${searchPattern}
    OR LOWER(COALESCE(c.first_name, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(c.last_name, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(c.company_name, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(c.department, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(c.job_title, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(c.vat_id, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(ce.email, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(cp.phone, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(ca.line1, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(ca.postal_code, '')) LIKE ${searchPattern}
    OR LOWER(COALESCE(ca.city, '')) LIKE ${searchPattern}
  )
`;

/**
 * Lists contacts for one book. System and manual books are resolved transparently.
 */
export const list = async (config: {
  bookId: string;
  pagination?: PageParams;
  filter?: { query?: string };
}): Promise<Paginated<Contact>> => {
  if (isSystemBookId(config.bookId)) {
    return listSystemContacts({
      pagination: config.pagination,
      filter: config.filter,
    });
  }

  if (!isUuid(config.bookId)) {
    return {
      items: [],
      page: config.pagination?.page ?? 1,
      perPage: config.pagination?.perPage ?? 20,
      total: 0,
      hasNext: false,
    };
  }

  const searchPattern = buildSearchPattern(config.filter?.query);
  const { page, perPage, offset } = paginate(config.pagination);

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(DISTINCT c.id)::int AS count
    FROM contacts.contacts c
    LEFT JOIN contacts.contact_emails ce ON ce.contact_id = c.id
    LEFT JOIN contacts.contact_phones cp ON cp.contact_id = c.id
    LEFT JOIN contacts.contact_addresses ca ON ca.contact_id = c.id
    WHERE c.book_id = ${config.bookId}::uuid
      AND ${mapManualSearchCondition(searchPattern)}
  `;

  const rows = await sql<DbContact[]>`
    SELECT DISTINCT
      c.id,
      c.book_id,
      c.display_name,
      LOWER(c.display_name) AS sort_name,
      c.first_name,
      c.last_name,
      c.company_name,
      c.department,
      c.job_title,
      c.vat_id,
      c.website,
      c.birthday,
      c.note,
      c.source,
      c.created_at,
      c.updated_at
    FROM contacts.contacts c
    LEFT JOIN contacts.contact_emails ce ON ce.contact_id = c.id
    LEFT JOIN contacts.contact_phones cp ON cp.contact_id = c.id
    LEFT JOIN contacts.contact_addresses ca ON ca.contact_id = c.id
    WHERE c.book_id = ${config.bookId}::uuid
      AND ${mapManualSearchCondition(searchPattern)}
    ORDER BY sort_name ASC, c.created_at ASC
    LIMIT ${perPage}
    OFFSET ${offset}
  `;

  const mapped = await getManualContactsByIds(rows.map((row) => row.id));
  const items = rows.map((row) => mapped.get(row.id) ?? null).filter((row): row is Contact => row !== null);

  const total = countRow?.count ?? 0;
  return {
    items,
    page,
    perPage,
    total,
    hasNext: page * perPage < total,
  };
};

/**
 * Returns one contact from one specific book.
 */
export const get = async (config: { bookId: string; id: string }): Promise<Contact | null> => {
  if (isSystemBookId(config.bookId)) {
    return getSystemContact({ id: config.id });
  }

  if (!isUuid(config.bookId) || !isUuid(config.id)) return null;

  const [row] = await sql<DbContact[]>`
    SELECT
      id,
      book_id,
      display_name,
      first_name,
      last_name,
      company_name,
      department,
      job_title,
      vat_id,
      website,
      birthday,
      note,
      source,
      created_at,
      updated_at
    FROM contacts.contacts
    WHERE id = ${config.id}::uuid
      AND book_id = ${config.bookId}::uuid
  `;

  if (!row) return null;

  const mapped = await getManualContactsByIds([row.id]);
  return mapped.get(row.id) ?? null;
};

/**
 * Creates one manual contact and all optional child entries.
 */
export const create = async (config: { bookId: string; data: CreateContactInput }): Promise<Result<Contact>> => {
  if (isSystemBookId(config.bookId)) {
    return fail(err.forbidden("System contacts are read-only"));
  }

  if (!isUuid(config.bookId)) return fail(err.notFound("Book"));

  const [row] = await sql<DbContact[]>`
    INSERT INTO contacts.contacts (
      book_id,
      display_name,
      first_name,
      last_name,
      company_name,
      department,
      job_title,
      vat_id,
      website,
      birthday,
      note,
      source
    ) VALUES (
      ${config.bookId}::uuid,
      ${config.data.displayName.trim()},
      ${emptyToNull(config.data.firstName) ?? null},
      ${emptyToNull(config.data.lastName) ?? null},
      ${emptyToNull(config.data.companyName) ?? null},
      ${emptyToNull(config.data.department) ?? null},
      ${emptyToNull(config.data.jobTitle) ?? null},
      ${emptyToNull(config.data.vatId) ?? null},
      ${emptyToNull(config.data.website) ?? null},
      ${config.data.birthday ?? null},
      ${emptyToNull(config.data.note) ?? null},
      ${emptyToNull(config.data.source) ?? "manual"}
    )
    RETURNING
      id,
      book_id,
      display_name,
      first_name,
      last_name,
      company_name,
      department,
      job_title,
      vat_id,
      website,
      birthday,
      note,
      source,
      created_at,
      updated_at
  `;

  if (!row) return fail(err.internal("Failed to create contact"));

  await replaceEmails(row.id, config.data.emails ?? []);
  await replacePhones(row.id, config.data.phones ?? []);
  await replaceAddresses(row.id, config.data.addresses ?? []);

  const created = await get({ bookId: row.book_id, id: row.id });
  if (!created) return fail(err.internal("Failed to load created contact"));

  return ok(created);
};

/**
 * Updates one manual contact. Child arrays are fully replaced when provided.
 */
export const update = async (config: { bookId: string; id: string; data: UpdateContactInput }): Promise<Result<Contact>> => {
  if (isSystemBookId(config.bookId)) {
    return fail(err.forbidden("System contacts are read-only"));
  }

  if (!isUuid(config.bookId) || !isUuid(config.id)) {
    return fail(err.notFound("Contact"));
  }

  const [existing] = await sql<DbContact[]>`
    SELECT
      id,
      book_id,
      display_name,
      first_name,
      last_name,
      company_name,
      department,
      job_title,
      vat_id,
      website,
      birthday,
      note,
      source,
      created_at,
      updated_at
    FROM contacts.contacts
    WHERE id = ${config.id}::uuid
      AND book_id = ${config.bookId}::uuid
  `;

  if (!existing) return fail(err.notFound("Contact"));

  const [row] = await sql<DbContact[]>`
    UPDATE contacts.contacts
    SET
      display_name = ${config.data.displayName?.trim() ?? existing.display_name},
      first_name = ${config.data.firstName === undefined ? existing.first_name : emptyToNull(config.data.firstName)},
      last_name = ${config.data.lastName === undefined ? existing.last_name : emptyToNull(config.data.lastName)},
      company_name = ${config.data.companyName === undefined ? existing.company_name : emptyToNull(config.data.companyName)},
      department = ${config.data.department === undefined ? existing.department : emptyToNull(config.data.department)},
      job_title = ${config.data.jobTitle === undefined ? existing.job_title : emptyToNull(config.data.jobTitle)},
      vat_id = ${config.data.vatId === undefined ? existing.vat_id : emptyToNull(config.data.vatId)},
      website = ${config.data.website === undefined ? existing.website : emptyToNull(config.data.website)},
      birthday = ${config.data.birthday === undefined ? existing.birthday : config.data.birthday},
      note = ${config.data.note === undefined ? existing.note : emptyToNull(config.data.note)},
      source = ${config.data.source === undefined ? existing.source : emptyToNull(config.data.source)},
      updated_at = now()
    WHERE id = ${config.id}::uuid
      AND book_id = ${config.bookId}::uuid
    RETURNING
      id,
      book_id,
      display_name,
      first_name,
      last_name,
      company_name,
      department,
      job_title,
      vat_id,
      website,
      birthday,
      note,
      source,
      created_at,
      updated_at
  `;

  if (!row) return fail(err.internal("Failed to update contact"));

  if (config.data.emails !== undefined) {
    await replaceEmails(row.id, config.data.emails);
  }
  if (config.data.phones !== undefined) {
    await replacePhones(row.id, config.data.phones);
  }
  if (config.data.addresses !== undefined) {
    await replaceAddresses(row.id, config.data.addresses);
  }

  const updated = await get({ bookId: row.book_id, id: row.id });
  if (!updated) return fail(err.internal("Failed to load updated contact"));

  return ok(updated);
};

/**
 * Deletes one contact from one manual book.
 */
export const remove = async (config: { bookId: string; id: string }): Promise<Result<void>> => {
  if (isSystemBookId(config.bookId)) {
    return fail(err.forbidden("System contacts are read-only"));
  }

  if (!isUuid(config.bookId) || !isUuid(config.id)) {
    return fail(err.notFound("Contact"));
  }

  const result = await sql`
    DELETE FROM contacts.contacts
    WHERE id = ${config.id}::uuid
      AND book_id = ${config.bookId}::uuid
  `;

  if (result.count === 0) return fail(err.notFound("Contact"));
  return ok();
};

/**
 * Global search across all readable manual books plus the virtual system book.
 */
export const search = async (config: {
  userId: string;
  groups: string[];
  pagination?: PageParams;
  filter?: { query?: string; includeSystem?: boolean };
}): Promise<Paginated<Contact>> => {
  const searchPattern = buildSearchPattern(config.filter?.query);
  const includeSystem = config.filter?.includeSystem ?? false;
  const { page, perPage, offset } = paginate(config.pagination);

  const [countRow] = await sql<{ count: number }[]>`
    WITH manual_matches AS (
      SELECT DISTINCT
        c.id AS contact_id,
        c.book_id::text AS book_id,
        'manual'::text AS source_kind
      FROM contacts.contacts c
      JOIN contacts.book_access ba ON ba.book_id = c.book_id
      JOIN auth.access a ON a.id = ba.access_id
      LEFT JOIN contacts.contact_emails ce ON ce.contact_id = c.id
      LEFT JOIN contacts.contact_phones cp ON cp.contact_id = c.id
      LEFT JOIN contacts.contact_addresses ca ON ca.contact_id = c.id
      WHERE (
        a.user_id = ${config.userId}::uuid
        OR a.group_cn = ANY(${toPgTextArray(config.groups)}::text[])
        OR (${config.userId}::uuid IS NOT NULL AND a.authenticated_only = true)
        OR (a.user_id IS NULL AND a.group_cn IS NULL AND a.authenticated_only = false)
      )
      AND ${mapManualSearchCondition(searchPattern)}
    ),
    system_matches AS (
      SELECT
        u.id AS contact_id,
        ${SYSTEM_BOOK_ID}::text AS book_id,
        'system'::text AS source_kind
      FROM auth.users u
      WHERE ${includeSystem}::boolean
        AND u.realm IN ('ipa', 'ipa-limited')
        AND (
          ${searchPattern}::text IS NULL
          OR LOWER(u.uid) LIKE ${searchPattern}
          OR LOWER(u.display_name) LIKE ${searchPattern}
          OR LOWER(u.given_name) LIKE ${searchPattern}
          OR LOWER(u.sn) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.mail, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.phone, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.mobile, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.employee_type, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.addr_street, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.addr_postal_code, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.addr_city, '')) LIKE ${searchPattern}
        )
    ),
    combined AS (
      SELECT * FROM manual_matches
      UNION ALL
      SELECT * FROM system_matches
    )
    SELECT COUNT(*)::int AS count
    FROM combined
  `;

  const rows = await sql<SearchRow[]>`
    WITH manual_matches AS (
      SELECT DISTINCT
        c.id AS contact_id,
        c.book_id::text AS book_id,
        c.display_name AS sort_name,
        'manual'::text AS source_kind
      FROM contacts.contacts c
      JOIN contacts.book_access ba ON ba.book_id = c.book_id
      JOIN auth.access a ON a.id = ba.access_id
      LEFT JOIN contacts.contact_emails ce ON ce.contact_id = c.id
      LEFT JOIN contacts.contact_phones cp ON cp.contact_id = c.id
      LEFT JOIN contacts.contact_addresses ca ON ca.contact_id = c.id
      WHERE (
        a.user_id = ${config.userId}::uuid
        OR a.group_cn = ANY(${toPgTextArray(config.groups)}::text[])
        OR (${config.userId}::uuid IS NOT NULL AND a.authenticated_only = true)
        OR (a.user_id IS NULL AND a.group_cn IS NULL AND a.authenticated_only = false)
      )
      AND ${mapManualSearchCondition(searchPattern)}
    ),
    system_matches AS (
      SELECT
        u.id AS contact_id,
        ${SYSTEM_BOOK_ID}::text AS book_id,
        COALESCE(NULLIF(u.display_name, ''), u.uid) AS sort_name,
        'system'::text AS source_kind
      FROM auth.users u
      WHERE ${includeSystem}::boolean
        AND u.realm IN ('ipa', 'ipa-limited')
        AND (
          ${searchPattern}::text IS NULL
          OR LOWER(u.uid) LIKE ${searchPattern}
          OR LOWER(u.display_name) LIKE ${searchPattern}
          OR LOWER(u.given_name) LIKE ${searchPattern}
          OR LOWER(u.sn) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.mail, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.phone, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.mobile, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.employee_type, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.addr_street, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.addr_postal_code, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(u.addr_city, '')) LIKE ${searchPattern}
        )
    ),
    combined AS (
      SELECT * FROM manual_matches
      UNION ALL
      SELECT * FROM system_matches
    )
    SELECT contact_id, book_id, source_kind
    FROM combined
    ORDER BY LOWER(sort_name) ASC, source_kind ASC, contact_id ASC
    LIMIT ${perPage}
    OFFSET ${offset}
  `;

  const manualIds = rows.filter((row) => row.source_kind === "manual").map((row) => row.contact_id);
  const systemIds = rows.filter((row) => row.source_kind === "system").map((row) => row.contact_id);

  const [manualContactsById, systemContactsById] = await Promise.all([
    getManualContactsByIds(manualIds),
    getSystemContactsByIds(systemIds),
  ]);

  const items = rows
    .map((row) =>
      row.source_kind === "manual" ? (manualContactsById.get(row.contact_id) ?? null) : (systemContactsById.get(row.contact_id) ?? null),
    )
    .filter((row): row is Contact => row !== null);

  const total = countRow?.count ?? 0;
  return {
    items,
    page,
    perPage,
    total,
    hasNext: page * perPage < total,
  };
};
