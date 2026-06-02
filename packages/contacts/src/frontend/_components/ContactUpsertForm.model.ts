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

export const buildContactPayload = (draft: ContactUpsertDraft): CreateContactInput => {
  const emails = draft.emails
    .map((email) => ({
      label: email.label.trim() || null,
      email: email.email.trim(),
    }))
    .filter((email) => email.email.length > 0);

  const phones = draft.phones
    .map((phone) => ({
      label: phone.label.trim() || null,
      phone: phone.phone.trim(),
    }))
    .filter((phone) => phone.phone.length > 0);

  const websites = draft.websites
    .map((website) => ({
      label: website.label.trim() || null,
      url: website.url.trim(),
    }))
    .filter((website) => website.url.length > 0);

  for (const website of websites) {
    if (!isSafeWebsiteUrl(website.url)) {
      throw new Error("Website URL must start with http:// or https://");
    }
  }

  const addresses = draft.addresses
    .map((address) => ({
      label: address.label.trim() || null,
      recipientName: address.recipientName.trim() || null,
      companyName: address.companyName.trim() || null,
      line1: address.line1.trim(),
      line2: address.line2.trim() || null,
      postalCode: address.postalCode.trim(),
      city: address.city.trim(),
      stateRegion: address.stateRegion.trim() || null,
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

  const bankAccounts = draft.bankAccounts
    .map((account) => ({
      label: account.label.trim() || null,
      accountHolderName: account.accountHolderName.trim(),
      iban: account.iban.replace(/\s+/g, "").toUpperCase(),
      bic: account.bic.replace(/\s+/g, "").toUpperCase() || null,
      bankName: account.bankName.trim() || null,
      note: account.note.trim() || null,
    }))
    .filter((account) => account.accountHolderName.length > 0 || account.iban.length > 0 || account.bic || account.bankName);

  for (const account of bankAccounts) {
    if (!account.accountHolderName || !account.iban) {
      throw new Error("Bank details need account holder name and IBAN");
    }
  }

  for (const address of addresses) {
    if (!address.line1 || !address.postalCode || !address.city) {
      throw new Error("Addresses need line1, postal code, and city");
    }
    if (address.countryCode.length !== 2) {
      throw new Error("Address country code must be 2 letters");
    }
  }

  const birthday = draft.birthday.trim();
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    throw new Error("Birthday must use format YYYY-MM-DD");
  }

  return {
    label: draft.label.trim() || null,
    firstName: draft.firstName.trim() || null,
    lastName: draft.lastName.trim() || null,
    companyName: draft.companyName.trim() || null,
    department: draft.department.trim() || null,
    jobTitle: draft.jobTitle.trim() || null,
    vatId: draft.vatId.trim() || null,
    birthday: birthday || null,
    salutation: draft.salutation.trim() || null,
    pronouns: draft.pronouns.trim() || null,
    preferredLanguage: draft.preferredLanguage.trim() || null,
    parentContactId: draft.parentRef?.id ?? null,
    tagIds: draft.tagIds,
    emails,
    phones,
    addresses,
    websites,
    bankAccounts,
  };
};
