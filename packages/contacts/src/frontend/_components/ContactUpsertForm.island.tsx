import { navigateTo, prompts, RemoveBtn, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, Index, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactRef } from "../../service";
import { resolveContactName } from "../../shared";
import ContactSearchPicker from "./ContactSearchPicker.island";
import ContactTagsPicker from "./ContactTagsPicker.island";

type ContactUpsertMode = "create" | "edit";

type Props = {
  mode: ContactUpsertMode;
  bookId: string;
  initialContact?: Contact | null;
  /**
   * Pre-fills the "Belongs to" field for create mode (e.g. the "Add member"
   * flow opens this form with the host contact already selected as parent).
   */
  defaultParent?: ContactRef | null;
  backHref?: string;
  onCancel?: () => void;
  onSaved?: (contact: Contact) => void;
  onDeleted?: () => void;
};

type EditableEmail = { label: string; email: string };
type EditablePhone = { label: string; phone: string };
type EditableWebsite = { label: string; url: string };
type EditableBankAccount = {
  label: string;
  accountHolderName: string;
  iban: string;
  bic: string;
  bankName: string;
  note: string;
};
type EditableAddress = {
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

const DEFAULT_EMAIL_LABEL = "Email";
const DEFAULT_PHONE_LABEL = "Telephone";
const DEFAULT_WEBSITE_LABEL = "Website";
const DEFAULT_BANK_ACCOUNT_LABEL = "Bank";
const DEFAULT_ADDRESS_LABEL = "Address";

const EMPTY_EMAIL: EditableEmail = {
  label: DEFAULT_EMAIL_LABEL,
  email: "",
};

const EMPTY_PHONE: EditablePhone = {
  label: DEFAULT_PHONE_LABEL,
  phone: "",
};

const EMPTY_WEBSITE: EditableWebsite = {
  label: DEFAULT_WEBSITE_LABEL,
  url: "",
};

const EMPTY_BANK_ACCOUNT: EditableBankAccount = {
  label: DEFAULT_BANK_ACCOUNT_LABEL,
  accountHolderName: "",
  iban: "",
  bic: "",
  bankName: "",
  note: "",
};

const EMPTY_ADDRESS: EditableAddress = {
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

const initialEmailRows = (contact: Contact | null): EditableEmail[] => {
  if (!contact) return [{ ...EMPTY_EMAIL }];
  return contact.emails.length > 0
    ? contact.emails.map((email) => ({
        label: email.label?.trim() || DEFAULT_EMAIL_LABEL,
        email: email.email,
      }))
    : [{ ...EMPTY_EMAIL }];
};

const initialPhoneRows = (contact: Contact | null): EditablePhone[] => {
  if (!contact) return [{ ...EMPTY_PHONE }];
  return contact.phones.length > 0
    ? contact.phones.map((phone) => ({
        label: phone.label?.trim() || DEFAULT_PHONE_LABEL,
        phone: phone.phone,
      }))
    : [{ ...EMPTY_PHONE }];
};

const initialWebsiteRows = (contact: Contact | null): EditableWebsite[] => {
  if (!contact) return [{ ...EMPTY_WEBSITE }];
  return contact.websites.length > 0
    ? contact.websites.map((website) => ({
        label: website.label?.trim() || DEFAULT_WEBSITE_LABEL,
        url: website.url,
      }))
    : [{ ...EMPTY_WEBSITE }];
};

const initialAddressRows = (contact: Contact | null): EditableAddress[] => {
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

const initialBankAccountRows = (contact: Contact | null): EditableBankAccount[] => {
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

const detailHref = (bookId: string, contactId: string) => `/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}`;

/**
 * Shared contact upsert form (create + edit) for manual books.
 */
export default function ContactUpsertForm(props: Props) {
  const initialContact = props.mode === "edit" ? (props.initialContact ?? null) : null;

  const [label, setLabel] = createSignal(initialContact?.label ?? "");
  const [firstName, setFirstName] = createSignal(initialContact?.firstName ?? "");
  const [lastName, setLastName] = createSignal(initialContact?.lastName ?? "");
  const [companyName, setCompanyName] = createSignal(initialContact?.companyName ?? "");
  const [department, setDepartment] = createSignal(initialContact?.department ?? "");
  const [jobTitle, setJobTitle] = createSignal(initialContact?.jobTitle ?? "");
  const [vatId, setVatId] = createSignal(initialContact?.vatId ?? "");
  const [websites, setWebsites] = createSignal<EditableWebsite[]>(initialWebsiteRows(initialContact));
  const [bankAccounts, setBankAccounts] = createSignal<EditableBankAccount[]>(initialBankAccountRows(initialContact));
  const [birthday, setBirthday] = createSignal(initialContact?.birthday ?? "");
  const [salutation, setSalutation] = createSignal(initialContact?.salutation ?? "");
  const [pronouns, setPronouns] = createSignal(initialContact?.pronouns ?? "");
  const [preferredLanguage, setPreferredLanguage] = createSignal(initialContact?.preferredLanguage ?? "");
  // Parent ref drives both the UI chip and the parentContactId payload field.
  // Edit mode seeds it from the loaded contact's parent; create flows can
  // pre-seed via `defaultParent` (used by the "Add member" dialog).
  const [parentRef, setParentRef] = createSignal<ContactRef | null>(initialContact?.parent ?? props.defaultParent ?? null);
  const [tagIds, setTagIds] = createSignal<string[]>(initialContact?.tags?.map((t) => t.id) ?? []);

  const [emails, setEmails] = createSignal<EditableEmail[]>(initialEmailRows(initialContact));
  const [phones, setPhones] = createSignal<EditablePhone[]>(initialPhoneRows(initialContact));
  const [addresses, setAddresses] = createSignal<EditableAddress[]>(initialAddressRows(initialContact));

  const upsertMutation = mutations.create<Contact, void>({
    mutation: async () => {
      const normalizedEmails = emails()
        .map((email) => ({
          label: email.label.trim() || null,
          email: email.email.trim(),
        }))
        .filter((email) => email.email.length > 0)
        .map((email) => ({ label: email.label, email: email.email }));

      const normalizedPhones = phones()
        .map((phone) => ({
          label: phone.label.trim() || null,
          phone: phone.phone.trim(),
        }))
        .filter((phone) => phone.phone.length > 0)
        .map((phone) => ({ label: phone.label, phone: phone.phone }));

      const normalizedWebsites = websites()
        .map((website) => ({
          label: website.label.trim() || null,
          url: website.url.trim(),
        }))
        .filter((website) => website.url.length > 0)
        .map((website) => ({ label: website.label, url: website.url }));

      const normalizedAddresses = addresses()
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
        .filter((address) => {
          return (
            address.line1.length > 0 ||
            address.postalCode.length > 0 ||
            address.city.length > 0 ||
            address.recipientName !== null ||
            address.companyName !== null
          );
        });

      const normalizedBankAccounts = bankAccounts()
        .map((account) => ({
          label: account.label.trim() || null,
          accountHolderName: account.accountHolderName.trim(),
          iban: account.iban.replace(/\s+/g, "").toUpperCase(),
          bic: account.bic.replace(/\s+/g, "").toUpperCase() || null,
          bankName: account.bankName.trim() || null,
          note: account.note.trim() || null,
        }))
        .filter((account) => account.accountHolderName.length > 0 || account.iban.length > 0 || account.bic || account.bankName);

      for (const account of normalizedBankAccounts) {
        if (!account.accountHolderName || !account.iban) {
          throw new Error("Bank details need account holder name and IBAN");
        }
      }

      for (const address of normalizedAddresses) {
        if (!address.line1 || !address.postalCode || !address.city) {
          throw new Error("Addresses need line1, postal code, and city");
        }
        if (address.countryCode.length !== 2) {
          throw new Error("Address country code must be 2 letters");
        }
      }

      const birthdayValue = birthday().trim();
      if (birthdayValue && !/^\d{4}-\d{2}-\d{2}$/.test(birthdayValue)) {
        throw new Error("Birthday must use format YYYY-MM-DD");
      }

      const payload = {
        label: label().trim() || null,
        firstName: firstName().trim() || null,
        lastName: lastName().trim() || null,
        companyName: companyName().trim() || null,
        department: department().trim() || null,
        jobTitle: jobTitle().trim() || null,
        vatId: vatId().trim() || null,
        birthday: birthdayValue || null,
        salutation: salutation().trim() || null,
        pronouns: pronouns().trim() || null,
        preferredLanguage: preferredLanguage().trim() || null,
        parentContactId: parentRef()?.id ?? null,
        tagIds: tagIds(),
        emails: normalizedEmails,
        phones: normalizedPhones,
        addresses: normalizedAddresses,
        websites: normalizedWebsites,
        bankAccounts: normalizedBankAccounts,
      };

      if (props.mode === "create") {
        const response = await apiClient.books[":bookId"].contacts.$post({
          param: { bookId: props.bookId },
          json: payload,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(data.message ?? "Failed to create contact");
        }

        const created = (await response.json()) as Contact;
        return created;
      }

      if (!initialContact) {
        throw new Error("Missing contact data for edit mode");
      }

      const response = await apiClient.books[":bookId"].contacts[":contactId"].$patch({
        param: {
          bookId: props.bookId,
          contactId: initialContact.id,
        },
        json: payload,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(data.message ?? "Failed to update contact");
      }

      return (await response.json()) as Contact;
    },
    onSuccess: (contact) => {
      toast.success(props.mode === "create" ? "Contact created" : "Contact updated");
      if (props.onSaved) {
        props.onSaved(contact);
        return;
      }
      navigateTo(detailHref(props.bookId, contact.id));
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  const removeMutation = mutations.create<Contact | null, void>({
    mutation: async () => {
      if (!initialContact) {
        throw new Error("Missing contact data for delete");
      }

      const confirmed = await prompts.confirm(`Delete "${resolveContactName(initialContact)}"? This cannot be undone.`, {
        title: "Delete Contact",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) return null;

      const response = await apiClient.books[":bookId"].contacts[":contactId"].$delete({
        param: {
          bookId: props.bookId,
          contactId: initialContact.id,
        },
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(data.message ?? "Failed to delete contact");
      }

      return initialContact;
    },
    onSuccess: (contact) => {
      if (!contact) return;
      toast.success("Contact deleted");
      if (props.onDeleted) {
        props.onDeleted();
        return;
      }
      navigateTo(`/app/contacts/${props.bookId}`);
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  const handleDelete = async () => {
    if (!initialContact) return;
    removeMutation.mutate(undefined);
  };

  const openParentPicker = async () => {
    const picked = await prompts.dialog<Contact | null>(
      (close) => (
        <ContactSearchPicker
          bookId={props.bookId}
          excludeIds={initialContact?.id ? [initialContact.id] : []}
          onSelect={(contact) => close(contact)}
        />
      ),
      { title: "Pick a parent contact", icon: "ti ti-corner-down-right", size: "medium" },
    );
    if (!picked) return;
    setParentRef({
      id: picked.id,
      label: picked.label,
      firstName: picked.firstName,
      lastName: picked.lastName,
      companyName: picked.companyName,
      jobTitle: picked.jobTitle,
    });
  };

  return (
    <div class="space-y-8">
      <section>
        <h3 class="detail-section-label">Identity</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput label="First Name" placeholder="Max" icon="ti ti-user" value={firstName} onInput={setFirstName} />
          <TextInput label="Last Name" placeholder="Mustermann" icon="ti ti-user" value={lastName} onInput={setLastName} />
          <div class="md:col-span-2">
            <TextInput
              label="Nickname"
              placeholder="e.g. Alex"
              description="Shown as the primary name in lists and the detail header. Falls back to first + last name when empty."
              icon="ti ti-user"
              value={label}
              onInput={setLabel}
            />
          </div>
          <div class="md:col-span-2">
            <div class="text-label mb-1.5 block text-xs">
              Belongs to <span class="font-normal text-dimmed">(optional)</span>
            </div>
            <p class="mb-2 text-[11px] text-dimmed">
              Link this contact under a parent (e.g. an employee under their company). Cycles are blocked by the server.
            </p>
            <Show
              when={parentRef()}
              fallback={
                <button type="button" class="btn-simple btn-sm w-fit text-xs text-dimmed hover:text-primary" onClick={openParentPicker}>
                  <i class="ti ti-corner-down-right" /> Pick a parent contact
                </button>
              }
            >
              {(parent) => (
                <div class="flex flex-wrap items-center gap-2">
                  <span class="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    <i class="ti ti-corner-down-right text-[10px]" />
                    {resolveContactName(parent())}
                  </span>
                  <button type="button" class="btn-simple btn-sm text-xs text-dimmed hover:text-primary" onClick={openParentPicker}>
                    Change
                  </button>
                  <button type="button" class="btn-simple btn-sm text-xs text-dimmed hover:text-red-500" onClick={() => setParentRef(null)}>
                    Clear
                  </button>
                </div>
              )}
            </Show>
          </div>
          <div class="md:col-span-2">
            <div class="text-label mb-1.5 block text-xs">
              Tags <span class="font-normal text-dimmed">(optional)</span>
            </div>
            <p class="mb-2 text-[11px] text-dimmed">
              Categorize the contact (e.g. „VIP", „Lead", „Supplier"). Tags are scoped to this book.
            </p>
            <ContactTagsPicker
              bookId={props.bookId}
              selectedIds={tagIds()}
              onChange={setTagIds}
              manageUrl={`/app/contacts/${props.bookId}/settings`}
              compact
            />
          </div>
        </div>
      </section>

      <section>
        <h3 class="detail-section-label">Personal</h3>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextInput label="Birthday" placeholder="1990-01-31" icon="ti ti-cake" value={birthday} onInput={setBirthday} />
          <TextInput
            label="Salutation / Title"
            placeholder="Dr., Prof., Ms., Mr."
            icon="ti ti-id-badge-2"
            value={salutation}
            onInput={setSalutation}
          />
          <TextInput
            label="Pronouns"
            placeholder="she/her, he/him, they/them"
            icon="ti ti-user-heart"
            value={pronouns}
            onInput={setPronouns}
          />
          <TextInput
            label="Preferred Language"
            placeholder="de, en, fr"
            icon="ti ti-language"
            value={preferredLanguage}
            onInput={setPreferredLanguage}
          />
        </div>
      </section>

      <section>
        <h3 class="detail-section-label">Work</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput
            label="Company"
            placeholder="Example GmbH"
            description="Shown as a chip in the contact header."
            icon="ti ti-building"
            value={companyName}
            onInput={setCompanyName}
          />
          <TextInput
            label="VAT ID"
            placeholder="DE123456789"
            description="Country prefix + ID, e.g. DE123456789."
            icon="ti ti-receipt-2"
            value={vatId}
            onInput={setVatId}
          />
          <TextInput label="Department" placeholder="Sales" icon="ti ti-hierarchy" value={department} onInput={setDepartment} />
          <TextInput label="Job Title" placeholder="Account Manager" icon="ti ti-briefcase" value={jobTitle} onInput={setJobTitle} />
        </div>
      </section>

      <section>
        <h3 class="detail-section-label">Reach</h3>
        <div class="space-y-5">
          <div class="space-y-2">
            <Index each={emails()}>
              {(email, index) => (
                <div class="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
                  <TextInput
                    ariaLabel="Email label"
                    placeholder="work, private…"
                    value={() => email().label}
                    onInput={(value) => setEmails((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)))}
                  />
                  <TextInput
                    ariaLabel="Email address"
                    placeholder="name@company.com"
                    icon="ti ti-mail text-blue-500 dark:text-blue-400"
                    value={() => email().email}
                    onInput={(value) => setEmails((current) => current.map((row, i) => (i === index ? { ...row, email: value } : row)))}
                  />
                  <div class="flex items-center justify-end">
                    <RemoveBtn ariaLabel="Remove email" onClick={() => setEmails((current) => current.filter((_, i) => i !== index))} />
                  </div>
                </div>
              )}
            </Index>
            <button
              type="button"
              class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
              onClick={() => setEmails([...emails(), { ...EMPTY_EMAIL }])}
            >
              <i class="ti ti-plus" /> Add email
            </button>
          </div>

          <div class="space-y-2">
            <Index each={phones()}>
              {(phone, index) => (
                <div class="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
                  <TextInput
                    ariaLabel="Telephone label"
                    placeholder="mobile, work…"
                    value={() => phone().label}
                    onInput={(value) => setPhones((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)))}
                  />
                  <TextInput
                    ariaLabel="Telephone number"
                    placeholder="+49 151 12345678"
                    icon="ti ti-phone text-green-600 dark:text-green-400"
                    value={() => phone().phone}
                    onInput={(value) => setPhones((current) => current.map((row, i) => (i === index ? { ...row, phone: value } : row)))}
                  />
                  <div class="flex items-center justify-end">
                    <RemoveBtn
                      ariaLabel="Remove phone number"
                      onClick={() => setPhones((current) => current.filter((_, i) => i !== index))}
                    />
                  </div>
                </div>
              )}
            </Index>
            <button
              type="button"
              class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
              onClick={() => setPhones([...phones(), { ...EMPTY_PHONE }])}
            >
              <i class="ti ti-plus" /> Add phone
            </button>
          </div>

          <div class="space-y-2">
            <Index each={websites()}>
              {(website, index) => (
                <div class="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
                  <TextInput
                    ariaLabel="Website label"
                    placeholder="work, personal…"
                    value={() => website().label}
                    onInput={(value) => setWebsites((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)))}
                  />
                  <TextInput
                    ariaLabel="Website URL"
                    placeholder="https://example.com"
                    icon="ti ti-world text-purple-600 dark:text-purple-400"
                    value={() => website().url}
                    onInput={(value) => setWebsites((current) => current.map((row, i) => (i === index ? { ...row, url: value } : row)))}
                  />
                  <div class="flex items-center justify-end">
                    <RemoveBtn ariaLabel="Remove website" onClick={() => setWebsites((current) => current.filter((_, i) => i !== index))} />
                  </div>
                </div>
              )}
            </Index>
            <button
              type="button"
              class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
              onClick={() => setWebsites([...websites(), { ...EMPTY_WEBSITE }])}
            >
              <i class="ti ti-plus" /> Add website
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 class="detail-section-label">Addresses</h3>
        <div class="space-y-3">
          <Index each={addresses()}>
            {(address, index) => (
              <div class="rounded-lg bg-zinc-200/60 p-3 dark:bg-zinc-800/40">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <TextInput
                    label="Label"
                    placeholder="e.g. office, home"
                    icon="ti ti-tag"
                    value={() => address().label}
                    onInput={(value) => setAddresses((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)))}
                  />
                  <TextInput
                    label="Recipient"
                    placeholder="Max Mustermann"
                    icon="ti ti-user"
                    value={() => address().recipientName}
                    onInput={(value) =>
                      setAddresses((current) => current.map((row, i) => (i === index ? { ...row, recipientName: value } : row)))
                    }
                  />
                  <div class="md:col-span-2">
                    <TextInput
                      label="Company"
                      placeholder="Example GmbH"
                      icon="ti ti-building"
                      value={() => address().companyName}
                      onInput={(value) =>
                        setAddresses((current) => current.map((row, i) => (i === index ? { ...row, companyName: value } : row)))
                      }
                    />
                  </div>
                  <TextInput
                    label="Address Line 1"
                    placeholder="Musterstraße 1"
                    icon="ti ti-home"
                    required
                    value={() => address().line1}
                    onInput={(value) => setAddresses((current) => current.map((row, i) => (i === index ? { ...row, line1: value } : row)))}
                  />
                  <TextInput
                    label="Address Line 2"
                    placeholder="c/o, floor, etc. (optional)"
                    icon="ti ti-home"
                    value={() => address().line2}
                    onInput={(value) => setAddresses((current) => current.map((row, i) => (i === index ? { ...row, line2: value } : row)))}
                  />
                  <TextInput
                    label="Postal Code"
                    placeholder="89073"
                    icon="ti ti-map-pin"
                    required
                    value={() => address().postalCode}
                    onInput={(value) =>
                      setAddresses((current) => current.map((row, i) => (i === index ? { ...row, postalCode: value } : row)))
                    }
                  />
                  <TextInput
                    label="City"
                    placeholder="Ulm"
                    icon="ti ti-building-community"
                    required
                    value={() => address().city}
                    onInput={(value) => setAddresses((current) => current.map((row, i) => (i === index ? { ...row, city: value } : row)))}
                  />
                  <TextInput
                    label="State / Region"
                    placeholder="Baden-Württemberg"
                    description="Optional. US state or other region."
                    icon="ti ti-map-2"
                    value={() => address().stateRegion}
                    onInput={(value) =>
                      setAddresses((current) => current.map((row, i) => (i === index ? { ...row, stateRegion: value } : row)))
                    }
                  />
                  <TextInput
                    label="Country Code"
                    placeholder="DE"
                    description="ISO 2-letter, e.g. DE, AT, CH."
                    icon="ti ti-flag"
                    value={() => address().countryCode}
                    onInput={(value) =>
                      setAddresses((current) => current.map((row, i) => (i === index ? { ...row, countryCode: value } : row)))
                    }
                  />
                </div>
                <div class="mt-4 flex justify-end">
                  <button
                    type="button"
                    class="btn-simple btn-sm text-xs text-dimmed hover:text-red-600 dark:hover:text-red-400"
                    onClick={() => setAddresses((current) => current.filter((_, i) => i !== index))}
                  >
                    <i class="ti ti-trash" /> Remove address
                  </button>
                </div>
              </div>
            )}
          </Index>
          <button
            type="button"
            class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
            onClick={() => setAddresses([...addresses(), { ...EMPTY_ADDRESS }])}
          >
            <i class="ti ti-plus" /> Add address
          </button>
        </div>
      </section>

      <section>
        <h3 class="detail-section-label">Bank Details</h3>
        <div class="space-y-3">
          <Index each={bankAccounts()}>
            {(account, index) => (
              <div class="rounded-lg bg-zinc-200/60 p-3 dark:bg-zinc-800/40">
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <TextInput
                    label="Label"
                    placeholder="e.g. billing, refunds"
                    icon="ti ti-tag"
                    value={() => account().label}
                    onInput={(value) =>
                      setBankAccounts((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)))
                    }
                  />
                  <TextInput
                    label="Account Holder"
                    placeholder="Max Mustermann"
                    icon="ti ti-user"
                    required
                    value={() => account().accountHolderName}
                    onInput={(value) =>
                      setBankAccounts((current) => current.map((row, i) => (i === index ? { ...row, accountHolderName: value } : row)))
                    }
                  />
                  <TextInput
                    label="IBAN"
                    placeholder="DE02120300000000202051"
                    icon="ti ti-credit-card"
                    required
                    value={() => account().iban}
                    onInput={(value) =>
                      setBankAccounts((current) => current.map((row, i) => (i === index ? { ...row, iban: value } : row)))
                    }
                  />
                  <TextInput
                    label="BIC"
                    placeholder="BYLADEM1001"
                    icon="ti ti-building-bank"
                    value={() => account().bic}
                    onInput={(value) => setBankAccounts((current) => current.map((row, i) => (i === index ? { ...row, bic: value } : row)))}
                  />
                  <TextInput
                    label="Bank Name"
                    placeholder="Example Bank"
                    icon="ti ti-building-bank"
                    value={() => account().bankName}
                    onInput={(value) =>
                      setBankAccounts((current) => current.map((row, i) => (i === index ? { ...row, bankName: value } : row)))
                    }
                  />
                  <TextInput
                    label="Note"
                    placeholder="Optional"
                    icon="ti ti-notes"
                    value={() => account().note}
                    onInput={(value) =>
                      setBankAccounts((current) => current.map((row, i) => (i === index ? { ...row, note: value } : row)))
                    }
                  />
                </div>
                <div class="mt-4 flex justify-end">
                  <button
                    type="button"
                    class="btn-simple btn-sm text-xs text-dimmed hover:text-red-600 dark:hover:text-red-400"
                    onClick={() => setBankAccounts((current) => current.filter((_, i) => i !== index))}
                  >
                    <i class="ti ti-trash" /> Remove bank details
                  </button>
                </div>
              </div>
            )}
          </Index>
          <button
            type="button"
            class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
            onClick={() => setBankAccounts([...bankAccounts(), { ...EMPTY_BANK_ACCOUNT }])}
          >
            <i class="ti ti-plus" /> Add bank details
          </button>
        </div>
      </section>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div>
          {props.mode === "edit" && (
            <button
              type="button"
              class="btn-danger btn-sm"
              aria-label="Delete contact"
              disabled={upsertMutation.loading() || removeMutation.loading()}
              onClick={handleDelete}
            >
              {removeMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
              Delete
            </button>
          )}
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Show
            when={props.backHref}
            fallback={
              <Show when={props.onCancel}>
                <button type="button" class="btn-secondary btn-sm" onClick={() => props.onCancel?.()}>
                  Cancel
                </button>
              </Show>
            }
          >
            <a href={props.backHref!} class="btn-secondary btn-sm">
              Cancel
            </a>
          </Show>
          <button
            type="button"
            class="btn-primary btn-sm"
            aria-label={props.mode === "create" ? "Create contact" : "Save contact changes"}
            disabled={upsertMutation.loading() || removeMutation.loading()}
            onClick={() => upsertMutation.mutate(undefined)}
          >
            {upsertMutation.loading() ? (
              <i class="ti ti-loader-2 animate-spin" />
            ) : (
              <i class={props.mode === "create" ? "ti ti-plus" : "ti ti-device-floppy"} />
            )}
            {props.mode === "create" ? "Create Contact" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
