import type {
  Contact,
  ContactAddressInput,
  ContactEmailInput,
  ContactPhoneInput,
  ContactWebsiteInput,
  CreateContactInput,
} from "./types";

/**
 * Minimal vCard 3.0 (de)serializer.
 *
 * Scope: roundtrips first/last/label/company/department/job/website/birthday/
 * emails/phones/addresses/vat-id. Tags + hierarchy are intentionally NOT
 * exported — both are book-scoped and would not survive arrival in a foreign
 * vCard consumer. Comments + notes timeline are also out of scope (notes have
 * authorship metadata that doesn't fit a flat NOTE line).
 *
 * The implementation is hand-rolled because the shape we exchange is small
 * and predictable; pulling a full RFC-2426 lib would be overkill.
 */

const CRLF = "\r\n";

const VCARD_LINE_LENGTH = 75;

/** vCard escaping per RFC 2426 §4. Order matters: backslash first. */
const escapeValue = (v: string): string =>
  v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

const unescapeValue = (v: string): string =>
  v.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

/**
 * Folds long lines per RFC 2426 §2.6: lines longer than 75 octets get split,
 * with continuation lines starting with one whitespace character.
 */
const foldLine = (line: string): string => {
  if (line.length <= VCARD_LINE_LENGTH) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + VCARD_LINE_LENGTH);
    out.push(i === 0 ? chunk : ` ${chunk}`);
    i += VCARD_LINE_LENGTH;
  }
  return out.join(CRLF);
};

/** Sanitises a label into an ASCII vCard TYPE token (`work`, `private`, …). */
const sanitiseType = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
};

const formatAdr = (a: ContactAddressInput): string => {
  // RFC 2426 §3.2.1 — ADR fields:
  //   po-box ; ext-address ; street ; locality ; region ; postal-code ; country
  const parts = [
    "",
    escapeValue(a.line2 ?? ""),
    escapeValue(a.line1 ?? ""),
    escapeValue(a.city ?? ""),
    escapeValue(a.stateRegion ?? ""),
    escapeValue(a.postalCode ?? ""),
    escapeValue(a.countryCode ?? ""),
  ];
  return parts.join(";");
};

/** Serialises one contact to a single VCARD entry. */
export const serializeContact = (contact: Contact): string => {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  const fullName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.label ||
    contact.companyName ||
    "Unnamed";
  lines.push(`FN:${escapeValue(fullName)}`);
  // N: family;given;additional;prefix;suffix
  lines.push(`N:${escapeValue(contact.lastName ?? "")};${escapeValue(contact.firstName ?? "")};;;`);

  if (contact.label) lines.push(`NICKNAME:${escapeValue(contact.label)}`);

  if (contact.companyName) {
    const orgValue = contact.department
      ? `${escapeValue(contact.companyName)};${escapeValue(contact.department)}`
      : escapeValue(contact.companyName);
    lines.push(`ORG:${orgValue}`);
  }
  if (contact.jobTitle) lines.push(`TITLE:${escapeValue(contact.jobTitle)}`);
  if (contact.birthday) lines.push(`BDAY:${contact.birthday}`);
  if (contact.vatId) lines.push(`X-VAT-ID:${escapeValue(contact.vatId)}`);

  for (const website of contact.websites ?? []) {
    const type = sanitiseType(website.label);
    const params = type ? `;TYPE=${type}` : "";
    lines.push(`URL${params}:${escapeValue(website.url)}`);
  }

  for (const email of contact.emails ?? []) {
    const type = sanitiseType(email.label);
    const params = type ? `;TYPE=${type}` : "";
    lines.push(`EMAIL${params}:${email.email}`);
  }

  for (const phone of contact.phones ?? []) {
    const type = sanitiseType(phone.label);
    const params = type ? `;TYPE=${type}` : "";
    lines.push(`TEL${params}:${phone.phone}`);
  }

  for (const address of contact.addresses ?? []) {
    const type = sanitiseType(address.label);
    const params = type ? `;TYPE=${type}` : "";
    lines.push(`ADR${params}:${formatAdr(address)}`);
  }

  lines.push("END:VCARD");
  return lines.map(foldLine).join(CRLF);
};

/** Joins multiple VCARDs with the standard CRLF separator. */
export const serializeBook = (contacts: Contact[]): string =>
  contacts.map(serializeContact).join(CRLF) + CRLF;

// --- Parser ----------------------------------------------------------------

type ParsedLine = {
  field: string;
  params: Record<string, string>;
  value: string;
};

const unfoldLines = (raw: string): string[] => {
  // RFC 2426 §2.6 — continuation lines start with whitespace; merge into
  // the previous logical line.
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
};

const parseLine = (line: string): ParsedLine | null => {
  const colonIdx = line.indexOf(":");
  if (colonIdx < 0) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segments = head.split(";");
  const field = (segments[0] ?? "").toUpperCase();
  if (!field) return null;
  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    const eq = seg.indexOf("=");
    if (eq < 0) {
      // Legacy form `EMAIL;WORK:...` — bare type token.
      params["TYPE"] = (params["TYPE"] ?? "") + (params["TYPE"] ? "," : "") + seg.toLowerCase();
    } else {
      params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
    }
  }
  return { field, params, value };
};

const splitParts = (value: string): string[] => {
  // Split on un-escaped semicolons.
  const out: string[] = [];
  let buf = "";
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      buf += ch + value[i + 1];
      i += 2;
      continue;
    }
    if (ch === ";") {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  out.push(buf);
  return out.map(unescapeValue);
};

const labelFromParams = (params: Record<string, string>): string | null => {
  const type = params["TYPE"];
  if (!type) return null;
  // Pick the first segment if the producer wrote `TYPE=work,internet`.
  const first = type.split(",")[0]?.trim() ?? "";
  return first.length > 0 ? first.toLowerCase() : null;
};

/** Best-effort parse of a vCard payload into draft contacts ready for create. */
export const parse = (raw: string): CreateContactInput[] => {
  const lines = unfoldLines(raw);
  const candidates: CreateContactInput[] = [];
  let current: CreateContactInput | null = null;
  let currentEmails: ContactEmailInput[] = [];
  let currentPhones: ContactPhoneInput[] = [];
  let currentAddresses: ContactAddressInput[] = [];
  let currentWebsites: ContactWebsiteInput[] = [];

  const finishCurrent = () => {
    if (!current) return;
    if (currentEmails.length > 0) current.emails = currentEmails;
    if (currentPhones.length > 0) current.phones = currentPhones;
    if (currentAddresses.length > 0) current.addresses = currentAddresses;
    if (currentWebsites.length > 0) current.websites = currentWebsites;
    candidates.push(current);
    current = null;
    currentEmails = [];
    currentPhones = [];
    currentAddresses = [];
    currentWebsites = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase() === "BEGIN:VCARD") {
      current = {};
      currentEmails = [];
      currentPhones = [];
      currentAddresses = [];
      currentWebsites = [];
      continue;
    }
    if (trimmed.toUpperCase() === "END:VCARD") {
      finishCurrent();
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(trimmed);
    if (!parsed) continue;

    switch (parsed.field) {
      case "VERSION":
        // The vCard version header carries no contact data; older code
        // accidentally fell through to the FN handler and stamped `3.0`
        // into the label of every entry.
        break;
      case "FN":
        // FN is denormalised — ignored if N comes through.
        if (!current.firstName && !current.lastName) {
          const value = unescapeValue(parsed.value);
          // Treat single-token FN as label/company guess; let later N override.
          if (!current.label) current.label = value;
        }
        break;
      case "N": {
        const parts = splitParts(parsed.value);
        current.lastName = parts[0]?.trim() || null;
        current.firstName = parts[1]?.trim() || null;
        // After we have a real N, drop the FN guess if it now duplicates.
        if (current.label && current.label === [current.firstName, current.lastName].filter(Boolean).join(" ")) {
          current.label = null;
        }
        break;
      }
      case "NICKNAME":
        current.label = unescapeValue(parsed.value).trim() || null;
        break;
      case "ORG": {
        const parts = splitParts(parsed.value);
        current.companyName = parts[0]?.trim() || null;
        if (parts[1]) current.department = parts[1].trim() || null;
        break;
      }
      case "TITLE":
        current.jobTitle = unescapeValue(parsed.value).trim() || null;
        break;
      case "BDAY": {
        const value = unescapeValue(parsed.value).trim();
        // Accept both YYYY-MM-DD and YYYYMMDD.
        const isoLike = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
        if (isoLike) current.birthday = `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;
        break;
      }
      case "URL": {
        const url = unescapeValue(parsed.value).trim();
        if (url.length > 0) {
          currentWebsites.push({ label: labelFromParams(parsed.params), url });
        }
        break;
      }
      case "X-VAT-ID":
        current.vatId = unescapeValue(parsed.value).trim() || null;
        break;
      case "EMAIL": {
        const email = unescapeValue(parsed.value).trim();
        if (email.length > 0) {
          currentEmails.push({ label: labelFromParams(parsed.params), email });
        }
        break;
      }
      case "TEL": {
        const phone = unescapeValue(parsed.value).trim();
        if (phone.length > 0) {
          currentPhones.push({ label: labelFromParams(parsed.params), phone });
        }
        break;
      }
      case "ADR": {
        const parts = splitParts(parsed.value);
        // [po, ext, street, locality, region, postal, country]
        const line1 = parts[2]?.trim() ?? "";
        const line2 = parts[1]?.trim() ?? "";
        const city = parts[3]?.trim() ?? "";
        const stateRegion = parts[4]?.trim() ?? "";
        const postalCode = parts[5]?.trim() ?? "";
        const countryCode = (parts[6]?.trim() ?? "").toUpperCase();
        // Service requires line1, postalCode, city. If any is missing, skip
        // this ADR — the candidate keeps its other fields.
        if (line1 && postalCode && city && countryCode.length === 2) {
          currentAddresses.push({
            label: labelFromParams(parsed.params),
            recipientName: null,
            companyName: null,
            line1,
            line2: line2 || null,
            postalCode,
            city,
            stateRegion: stateRegion || null,
            countryCode,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  finishCurrent();
  return candidates;
};

// --- CSV export (flat, lossy) ----------------------------------------------

const csvCell = (value: string | null | undefined): string => {
  const v = value ?? "";
  if (v.includes(",") || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
};

const CSV_MAX_EMAILS = 5;
const CSV_MAX_PHONES = 5;
const CSV_MAX_WEBSITES = 5;
const CSV_MAX_ADDRESSES = 2;

const CSV_HEADER: string[] = [
  "First Name",
  "Last Name",
  "Nickname",
  "Company",
  "Department",
  "Job Title",
  "VAT ID",
  "Birthday",
  ...Array.from({ length: CSV_MAX_EMAILS }, (_, i) => `Email-${i + 1}`),
  ...Array.from({ length: CSV_MAX_PHONES }, (_, i) => `Phone-${i + 1}`),
  ...Array.from({ length: CSV_MAX_WEBSITES }, (_, i) => `Website-${i + 1}`),
  ...Array.from({ length: CSV_MAX_ADDRESSES }, (_, i) => `Address-${i + 1}`),
];

/** Concatenates one address into a single human-readable line for the CSV. */
const formatAddressLine = (a: Contact["addresses"][number] | undefined): string => {
  if (!a) return "";
  const street = [a.line1, a.line2].filter(Boolean).join(", ");
  const city = [a.postalCode, a.city].filter(Boolean).join(" ");
  const region = [a.stateRegion, a.countryCode].filter(Boolean).join(", ");
  return [street, city, region].filter(Boolean).join(", ");
};

/**
 * Flat CSV with multiple email / phone / website columns and one column per
 * concatenated address. Designed for spreadsheet review and one-shot export
 * (no roundtrip — re-importing a CSV is unsupported; use vCard for that).
 */
export const serializeBookCsv = (contacts: Contact[]): string => {
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const c of contacts) {
    const cells: string[] = [
      csvCell(c.firstName),
      csvCell(c.lastName),
      csvCell(c.label),
      csvCell(c.companyName),
      csvCell(c.department),
      csvCell(c.jobTitle),
      csvCell(c.vatId),
      csvCell(c.birthday),
    ];
    for (let i = 0; i < CSV_MAX_EMAILS; i++) cells.push(csvCell(c.emails?.[i]?.email));
    for (let i = 0; i < CSV_MAX_PHONES; i++) cells.push(csvCell(c.phones?.[i]?.phone));
    for (let i = 0; i < CSV_MAX_WEBSITES; i++) cells.push(csvCell(c.websites?.[i]?.url));
    for (let i = 0; i < CSV_MAX_ADDRESSES; i++) cells.push(csvCell(formatAddressLine(c.addresses?.[i])));
    lines.push(cells.join(","));
  }
  return lines.join(CRLF) + CRLF;
};
