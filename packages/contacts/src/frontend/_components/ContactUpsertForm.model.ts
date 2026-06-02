import type { Contact, ContactRef, CreateContactInput } from "../../service";
import { isSafeWebsiteUrl } from "../../shared";

export type EditableEmail = { label: string; email: string };
export type EditablePhone = { label: string; phone: string };
export type EditableWebsite = { label: string; url: string };
export type EditableBankAccount = {
  label: string;
  accountHolderName: string;
  iban: string;
  bic: string;
  bankName: string;
  note: string;
};
export type EditableAddress = {
  label: string;
  recipientName: string;
  companyName: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  stateRegion: string;
  countryCode: string;
};

export type ContactUpsertDraft = {
  label: string;
  firstName: string;
  lastName: string;
  companyName: string;
  department: string;
  jobTitle: string;
  vatId: string;
  birthday: string;
  salutation: string;
  pronouns: string;
  preferredLanguage: string;
  parentRef: ContactRef | null;
  tagIds: string[];
  emails: EditableEmail[];
  phones: EditablePhone[];
  addresses: EditableAddress[];
  websites: EditableWebsite[];
  bankAccounts: EditableBankAccount[];
};

export const DEFAULT_EMAIL_LABEL = "Email";
export const DEFAULT_PHONE_LABEL = "Telephone";
export const DEFAULT_WEBSITE_LABEL = "Website";
export const DEFAULT_BANK_ACCOUNT_LABEL = "Bank";
export const DEFAULT_ADDRESS_LABEL = "Address";

export const EMPTY_EMAIL: EditableEmail = {
  label: DEFAULT_EMAIL_LABEL,
  email: "",
};

export const EMPTY_PHONE: EditablePhone = {
  label: DEFAULT_PHONE_LABEL,
  phone: "",
};

export const EMPTY_WEBSITE: EditableWebsite = {
  label: DEFAULT_WEBSITE_LABEL,
  url: "",
};

export const EMPTY_BANK_ACCOUNT: EditableBankAccount = {
  label: DEFAULT_BANK_ACCOUNT_LABEL,
  accountHolderName: "",
  iban: "",
  bic: "",
  bankName: "",
  note: "",
};

export const EMPTY_ADDRESS: EditableAddress = {
  label: DEFAULT_ADDRESS_LABEL,
  recipientName: "",
  companyName: "",
  line1: "",
  line2: "",
  postalCode: "",
  city: "",
  stateRegion: "",
  countryCode: "DE",
};

export const initialEmailRows = (contact: Contact | null): EditableEmail[] => {
  if (!contact) return [{ ...EMPTY_EMAIL }];
  return contact.emails.length > 0
    ? contact.emails.map((email) => ({
        label: email.label?.trim() || DEFAULT_EMAIL_LABEL,
        email: email.email,
      }))
    : [{ ...EMPTY_EMAIL }];
};

export const initialPhoneRows = (contact: Contact | null): EditablePhone[] => {
  if (!contact) return [{ ...EMPTY_PHONE }];
  return contact.phones.length > 0
    ? contact.phones.map((phone) => ({
        label: phone.label?.trim() || DEFAULT_PHONE_LABEL,
        phone: phone.phone,
      }))
    : [{ ...EMPTY_PHONE }];
};

export const initialWebsiteRows = (contact: Contact | null): EditableWebsite[] => {
  if (!contact) return [{ ...EMPTY_WEBSITE }];
  return contact.websites.length > 0
    ? contact.websites.map((website) => ({
        label: website.label?.trim() || DEFAULT_WEBSITE_LABEL,
        url: website.url,
      }))
    : [{ ...EMPTY_WEBSITE }];
};

export const initialAddressRows = (contact: Contact | null): EditableAddress[] => {
  if (!contact) return [{ ...EMPTY_ADDRESS }];
  return contact.addresses.length > 0
    ? contact.addresses.map((address) => ({
        label: address.label?.trim() || DEFAULT_ADDRESS_LABEL,
        recipientName: address.recipientName ?? "",
        companyName: address.companyName ?? "",
        line1: address.line1,
        line2: address.line2 ?? "",
        postalCode: address.postalCode,
        city: address.city,
        stateRegion: address.stateRegion ?? "",
        countryCode: address.countryCode,
      }))
    : [{ ...EMPTY_ADDRESS }];
};

export const initialBankAccountRows = (contact: Contact | null): EditableBankAccount[] => {
  if (!contact) return [];
  return contact.bankAccounts.map((account) => ({
    label: account.label?.trim() || DEFAULT_BANK_ACCOUNT_LABEL,
    accountHolderName: account.accountHolderName,
    iban: account.iban,
    bic: account.bic ?? "",
    bankName: account.bankName ?? "",
    note: account.note ?? "",
  }));
};

const cleanText = (value: string): string | null => value.trim() || null;
const cleanUpperCompact = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

const normalizeEmails = (rows: EditableEmail[]) =>
  rows
    .map((email) => ({
      label: cleanText(email.label),
      email: email.email.trim(),
    }))
    .filter((email) => email.email.length > 0);

const normalizePhones = (rows: EditablePhone[]) =>
  rows
    .map((phone) => ({
      label: cleanText(phone.label),
      phone: phone.phone.trim(),
    }))
    .filter((phone) => phone.phone.length > 0);

const normalizeWebsites = (rows: EditableWebsite[]) =>
  rows
    .map((website) => ({
      label: cleanText(website.label),
      url: website.url.trim(),
    }))
    .filter((website) => website.url.length > 0);

const validateWebsites = (websites: ReturnType<typeof normalizeWebsites>) => {
  for (const website of websites) {
    if (!isSafeWebsiteUrl(website.url)) throw new Error("Website URL must start with http:// or https://");
  }
};

const normalizeAddresses = (rows: EditableAddress[]) =>
  rows
    .map((address) => ({
      label: cleanText(address.label),
      recipientName: cleanText(address.recipientName),
      companyName: cleanText(address.companyName),
      line1: address.line1.trim(),
      line2: cleanText(address.line2),
      postalCode: address.postalCode.trim(),
      city: address.city.trim(),
      stateRegion: cleanText(address.stateRegion),
      countryCode: address.countryCode.trim().toUpperCase(),
    }))
    .filter(
      (address) =>
        address.line1.length > 0 ||
        address.postalCode.length > 0 ||
        address.city.length > 0 ||
        address.recipientName !== null ||
        address.companyName !== null,
    );

const validateAddresses = (addresses: ReturnType<typeof normalizeAddresses>) => {
  for (const address of addresses) {
    if (!address.line1 || !address.postalCode || !address.city) throw new Error("Addresses need line1, postal code, and city");
    if (address.countryCode.length !== 2) throw new Error("Address country code must be 2 letters");
  }
};

const normalizeBankAccounts = (rows: EditableBankAccount[]) =>
  rows
    .map((account) => ({
      label: cleanText(account.label),
      accountHolderName: account.accountHolderName.trim(),
      iban: cleanUpperCompact(account.iban),
      bic: cleanUpperCompact(account.bic) || null,
      bankName: cleanText(account.bankName),
      note: cleanText(account.note),
    }))
    .filter((account) => account.accountHolderName.length > 0 || account.iban.length > 0 || account.bic || account.bankName);

const validateBankAccounts = (bankAccounts: ReturnType<typeof normalizeBankAccounts>) => {
  for (const account of bankAccounts) {
    if (!account.accountHolderName || !account.iban) throw new Error("Bank details need account holder name and IBAN");
  }
};

const normalizeBirthday = (value: string): string | null => {
  const birthday = value.trim();
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    throw new Error("Birthday must use format YYYY-MM-DD");
  }
  return birthday || null;
};

export const buildContactPayload = (draft: ContactUpsertDraft): CreateContactInput => {
  const emails = normalizeEmails(draft.emails);
  const phones = normalizePhones(draft.phones);
  const websites = normalizeWebsites(draft.websites);
  const addresses = normalizeAddresses(draft.addresses);
  const bankAccounts = normalizeBankAccounts(draft.bankAccounts);

  validateWebsites(websites);
  validateAddresses(addresses);
  validateBankAccounts(bankAccounts);

  return {
    label: cleanText(draft.label),
    firstName: cleanText(draft.firstName),
    lastName: cleanText(draft.lastName),
    companyName: cleanText(draft.companyName),
    department: cleanText(draft.department),
    jobTitle: cleanText(draft.jobTitle),
    vatId: cleanText(draft.vatId),
    birthday: normalizeBirthday(draft.birthday),
    salutation: cleanText(draft.salutation),
    pronouns: cleanText(draft.pronouns),
    preferredLanguage: cleanText(draft.preferredLanguage),
    parentContactId: draft.parentRef?.id ?? null,
    tagIds: draft.tagIds,
    emails,
    phones,
    addresses,
    websites,
    bankAccounts,
  };
};
