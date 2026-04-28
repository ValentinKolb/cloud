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
  emails?: ContactEmailInput[];
  phones?: ContactPhoneInput[];
  addresses?: ContactAddressInput[];
};
