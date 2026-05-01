export type ContactBook = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ContactEmail = {
  id: string;
  contactId: string;
  label: string | null;
  email: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ContactPhone = {
  id: string;
  contactId: string;
  label: string | null;
  phone: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ContactAddress = {
  id: string;
  contactId: string;
  label: string | null;
  recipientName: string | null;
  companyName: string | null;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  stateRegion: string | null;
  countryCode: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Minimal contact fields used to render parent chips and member lists in the
 * UI without dragging full contact rows around. Always loaded inline in the
 * main contact query so a single round-trip resolves the hierarchy view.
 */
export type ContactRef = {
  id: string;
  label: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  jobTitle: string | null;
};

export type Contact = {
  id: string;
  bookId: string;
  label: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  department: string | null;
  jobTitle: string | null;
  vatId: string | null;
  website: string | null;
  birthday: string | null;
  note: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactAddress[];
  /** Direct parent in the hierarchy, null if this contact is at the root. */
  parentContactId: string | null;
  parent: ContactRef | null;
  /** Direct children only — UI does not load grandchildren in one go. */
  members: ContactRef[];
};

export type CreateBookInput = {
  name: string;
  description?: string;
};

export type UpdateBookInput = {
  name?: string;
  description?: string | null;
};

export type ContactEmailInput = {
  label?: string | null;
  email: string;
};

export type ContactPhoneInput = {
  label?: string | null;
  phone: string;
};

export type ContactAddressInput = {
  label?: string | null;
  recipientName?: string | null;
  companyName?: string | null;
  line1: string;
  line2?: string | null;
  postalCode: string;
  city: string;
  stateRegion?: string | null;
  countryCode: string;
};

export type CreateContactInput = {
  label?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  vatId?: string | null;
  website?: string | null;
  birthday?: string | null;
  note?: string | null;
  source?: string | null;
  parentContactId?: string | null;
  emails?: ContactEmailInput[];
  phones?: ContactPhoneInput[];
  addresses?: ContactAddressInput[];
};

export type UpdateContactInput = {
  label?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  vatId?: string | null;
  website?: string | null;
  birthday?: string | null;
  note?: string | null;
  source?: string | null;
  parentContactId?: string | null;
  emails?: ContactEmailInput[];
  phones?: ContactPhoneInput[];
  addresses?: ContactAddressInput[];
};
