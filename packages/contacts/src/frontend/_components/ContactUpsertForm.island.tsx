import { navigateTo, PanelDialog, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { type Accessor, createSignal, type Setter, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactRef } from "../../service";
import { resolveContactName } from "../../shared";
import { readErrorMessage } from "./api";
import ContactSearchPicker from "./ContactSearchPicker.island";
import ContactTagsPicker from "./ContactTagsPicker.island";
import { AddressFields, BankAccountFields, ReachFields } from "./ContactUpsertForm.fields";
import {
  buildContactPayload,
  type EditableAddress,
  type EditableBankAccount,
  type EditableEmail,
  type EditablePhone,
  type EditableWebsite,
  initialAddressRows,
  initialBankAccountRows,
  initialEmailRows,
  initialPhoneRows,
  initialWebsiteRows,
} from "./ContactUpsertForm.model";

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
  title?: string;
  subtitle?: string;
  icon?: string;
  backHref?: string;
  onCancel?: () => void;
  onSaved?: (contact: Contact) => void;
  onDeleted?: () => void;
};

const detailHref = (bookId: string, contactId: string) => `/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}`;

type IdentitySectionProps = {
  bookId: string;
  initialContact: Contact | null;
  label: Accessor<string>;
  setLabel: Setter<string>;
  firstName: Accessor<string>;
  setFirstName: Setter<string>;
  lastName: Accessor<string>;
  setLastName: Setter<string>;
  parentRef: Accessor<ContactRef | null>;
  setParentRef: Setter<ContactRef | null>;
  tagIds: Accessor<string[]>;
  setTagIds: Setter<string[]>;
  openParentPicker: () => void;
};

const IdentitySection = (props: IdentitySectionProps) => (
  <PanelDialog.Section title="Identity" subtitle="Name, parent contact, and book tags." icon="ti ti-id">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <TextInput label="First Name" placeholder="Max" icon="ti ti-user" value={props.firstName} onInput={props.setFirstName} />
      <TextInput label="Last Name" placeholder="Mustermann" icon="ti ti-user" value={props.lastName} onInput={props.setLastName} />
      <div class="md:col-span-2">
        <TextInput
          label="Nickname"
          placeholder="e.g. Alex"
          description="Shown as the primary name in lists and the detail header. Falls back to first + last name when empty."
          icon="ti ti-user"
          value={props.label}
          onInput={props.setLabel}
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
          when={props.parentRef()}
          fallback={
            <button type="button" class="btn-simple btn-sm w-fit text-xs text-dimmed hover:text-primary" onClick={props.openParentPicker}>
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
              <button type="button" class="btn-simple btn-sm text-xs text-dimmed hover:text-primary" onClick={props.openParentPicker}>
                Change
              </button>
              <button
                type="button"
                class="btn-simple btn-sm text-xs text-dimmed hover:text-red-500"
                onClick={() => props.setParentRef(null)}
              >
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
        <p class="mb-2 text-[11px] text-dimmed">Categorize the contact (e.g. „VIP", „Lead", „Supplier"). Tags are scoped to this book.</p>
        <ContactTagsPicker
          bookId={props.bookId}
          selectedIds={props.tagIds()}
          onChange={props.setTagIds}
          manageUrl={`/app/contacts/${props.bookId}/settings`}
          compact
        />
      </div>
    </div>
  </PanelDialog.Section>
);

type PersonalSectionProps = {
  birthday: Accessor<string>;
  setBirthday: Setter<string>;
  salutation: Accessor<string>;
  setSalutation: Setter<string>;
  pronouns: Accessor<string>;
  setPronouns: Setter<string>;
  preferredLanguage: Accessor<string>;
  setPreferredLanguage: Setter<string>;
};

const PersonalSection = (props: PersonalSectionProps) => (
  <PanelDialog.Section title="Personal" subtitle="Optional personal profile details." icon="ti ti-user-heart">
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <TextInput label="Birthday" placeholder="1990-01-31" icon="ti ti-cake" value={props.birthday} onInput={props.setBirthday} />
      <TextInput
        label="Salutation / Title"
        placeholder="Dr., Prof., Ms., Mr."
        icon="ti ti-id-badge-2"
        value={props.salutation}
        onInput={props.setSalutation}
      />
      <TextInput
        label="Pronouns"
        placeholder="she/her, he/him, they/them"
        icon="ti ti-user-heart"
        value={props.pronouns}
        onInput={props.setPronouns}
      />
      <TextInput
        label="Preferred Language"
        placeholder="de, en, fr"
        icon="ti ti-language"
        value={props.preferredLanguage}
        onInput={props.setPreferredLanguage}
      />
    </div>
  </PanelDialog.Section>
);

type WorkSectionProps = {
  companyName: Accessor<string>;
  setCompanyName: Setter<string>;
  vatId: Accessor<string>;
  setVatId: Setter<string>;
  department: Accessor<string>;
  setDepartment: Setter<string>;
  jobTitle: Accessor<string>;
  setJobTitle: Setter<string>;
};

const WorkSection = (props: WorkSectionProps) => (
  <PanelDialog.Section title="Work" subtitle="Company, role, department, and billing identifiers." icon="ti ti-briefcase">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <TextInput
        label="Company"
        placeholder="Example GmbH"
        description="Shown as a chip in the contact header."
        icon="ti ti-building"
        value={props.companyName}
        onInput={props.setCompanyName}
      />
      <TextInput
        label="VAT ID"
        placeholder="DE123456789"
        description="Country prefix + ID, e.g. DE123456789."
        icon="ti ti-receipt-2"
        value={props.vatId}
        onInput={props.setVatId}
      />
      <TextInput label="Department" placeholder="Sales" icon="ti ti-hierarchy" value={props.department} onInput={props.setDepartment} />
      <TextInput
        label="Job Title"
        placeholder="Account Manager"
        icon="ti ti-briefcase"
        value={props.jobTitle}
        onInput={props.setJobTitle}
      />
    </div>
  </PanelDialog.Section>
);

type FooterContentProps = {
  mode: ContactUpsertMode;
  backHref?: string;
  onCancel?: () => void;
  saving: boolean;
  deleting: boolean;
  onDelete: () => void;
  onSave: () => void;
};

const FooterContent = (props: FooterContentProps) => (
  <div class="flex w-full flex-wrap items-center justify-between gap-2">
    <div>
      {props.mode === "edit" && (
        <button
          type="button"
          class="btn-danger btn-sm"
          aria-label="Delete contact"
          disabled={props.saving || props.deleting}
          onClick={props.onDelete}
        >
          {props.deleting ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
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
        disabled={props.saving || props.deleting}
        onClick={props.onSave}
      >
        {props.saving ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <i class={props.mode === "create" ? "ti ti-plus" : "ti ti-device-floppy"} />
        )}
        {props.mode === "create" ? "Create Contact" : "Save Changes"}
      </button>
    </div>
  </div>
);

type SaveContactConfig = {
  mode: ContactUpsertMode;
  bookId: string;
  initialContact: Contact | null;
  payload: ReturnType<typeof buildContactPayload>;
};

const saveContact = async (config: SaveContactConfig): Promise<Contact> => {
  if (config.mode === "create") {
    const response = await apiClient.books[":bookId"].contacts.$post({
      param: { bookId: config.bookId },
      json: config.payload,
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create contact"));
    return await response.json();
  }

  if (!config.initialContact) throw new Error("Missing contact data for edit mode");
  const response = await apiClient.books[":bookId"].contacts[":contactId"].$patch({
    param: {
      bookId: config.bookId,
      contactId: config.initialContact.id,
    },
    json: config.payload,
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update contact"));
  return await response.json();
};

const deleteContact = async (bookId: string, initialContact: Contact | null): Promise<Contact | null> => {
  if (!initialContact) throw new Error("Missing contact data for delete");

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
      bookId,
      contactId: initialContact.id,
    },
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete contact"));
  return initialContact;
};

const afterSave = (config: { mode: ContactUpsertMode; bookId: string; onSaved?: (contact: Contact) => void }, contact: Contact) => {
  toast.success(config.mode === "create" ? "Contact created" : "Contact updated");
  if (config.onSaved) {
    config.onSaved(contact);
    return;
  }
  navigateTo(detailHref(config.bookId, contact.id));
};

const afterDelete = (config: { bookId: string; onDeleted?: () => void }, contact: Contact | null) => {
  if (!contact) return;
  toast.success("Contact deleted");
  if (config.onDeleted) {
    config.onDeleted();
    return;
  }
  navigateTo(`/app/contacts/${config.bookId}`);
};

const contactText = (contact: Contact | null, select: (contact: Contact) => string | null): string =>
  contact ? (select(contact) ?? "") : "";
const contactParent = (contact: Contact | null, defaultParent: ContactRef | null | undefined): ContactRef | null =>
  contact?.parent ?? defaultParent ?? null;
const contactTagIds = (contact: Contact | null): string[] => contact?.tags?.map((tag) => tag.id) ?? [];
const createContactTextSignal = (contact: Contact | null, select: (contact: Contact) => string | null) =>
  createSignal(contactText(contact, select));

const createContactFormState = (initialContact: Contact | null, defaultParent: ContactRef | null | undefined) => {
  const [label, setLabel] = createContactTextSignal(initialContact, (contact) => contact.label);
  const [firstName, setFirstName] = createContactTextSignal(initialContact, (contact) => contact.firstName);
  const [lastName, setLastName] = createContactTextSignal(initialContact, (contact) => contact.lastName);
  const [companyName, setCompanyName] = createContactTextSignal(initialContact, (contact) => contact.companyName);
  const [department, setDepartment] = createContactTextSignal(initialContact, (contact) => contact.department);
  const [jobTitle, setJobTitle] = createContactTextSignal(initialContact, (contact) => contact.jobTitle);
  const [vatId, setVatId] = createContactTextSignal(initialContact, (contact) => contact.vatId);
  const [websites, setWebsites] = createSignal<EditableWebsite[]>(initialWebsiteRows(initialContact));
  const [bankAccounts, setBankAccounts] = createSignal<EditableBankAccount[]>(initialBankAccountRows(initialContact));
  const [birthday, setBirthday] = createContactTextSignal(initialContact, (contact) => contact.birthday);
  const [salutation, setSalutation] = createContactTextSignal(initialContact, (contact) => contact.salutation);
  const [pronouns, setPronouns] = createContactTextSignal(initialContact, (contact) => contact.pronouns);
  const [preferredLanguage, setPreferredLanguage] = createContactTextSignal(initialContact, (contact) => contact.preferredLanguage);
  const [parentRef, setParentRef] = createSignal<ContactRef | null>(contactParent(initialContact, defaultParent));
  const [tagIds, setTagIds] = createSignal<string[]>(contactTagIds(initialContact));
  const [emails, setEmails] = createSignal<EditableEmail[]>(initialEmailRows(initialContact));
  const [phones, setPhones] = createSignal<EditablePhone[]>(initialPhoneRows(initialContact));
  const [addresses, setAddresses] = createSignal<EditableAddress[]>(initialAddressRows(initialContact));

  return {
    label,
    setLabel,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    companyName,
    setCompanyName,
    department,
    setDepartment,
    jobTitle,
    setJobTitle,
    vatId,
    setVatId,
    websites,
    setWebsites,
    bankAccounts,
    setBankAccounts,
    birthday,
    setBirthday,
    salutation,
    setSalutation,
    pronouns,
    setPronouns,
    preferredLanguage,
    setPreferredLanguage,
    parentRef,
    setParentRef,
    tagIds,
    setTagIds,
    emails,
    setEmails,
    phones,
    setPhones,
    addresses,
    setAddresses,
  };
};

/**
 * Shared contact upsert form (create + edit) for manual books.
 */
export default function ContactUpsertForm(props: Props) {
  const initialContact = props.mode === "edit" ? (props.initialContact ?? null) : null;
  const form = createContactFormState(initialContact, props.defaultParent);
  const {
    label,
    setLabel,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    companyName,
    setCompanyName,
    department,
    setDepartment,
    jobTitle,
    setJobTitle,
    vatId,
    setVatId,
    websites,
    setWebsites,
    bankAccounts,
    setBankAccounts,
    birthday,
    setBirthday,
    salutation,
    setSalutation,
    pronouns,
    setPronouns,
    preferredLanguage,
    setPreferredLanguage,
    parentRef,
    setParentRef,
    tagIds,
    setTagIds,
    emails,
    setEmails,
    phones,
    setPhones,
    addresses,
    setAddresses,
  } = form;

  const draftPayload = () =>
    buildContactPayload({
      label: label(),
      firstName: firstName(),
      lastName: lastName(),
      companyName: companyName(),
      department: department(),
      jobTitle: jobTitle(),
      vatId: vatId(),
      birthday: birthday(),
      salutation: salutation(),
      pronouns: pronouns(),
      preferredLanguage: preferredLanguage(),
      parentRef: parentRef(),
      tagIds: tagIds(),
      emails: emails(),
      phones: phones(),
      addresses: addresses(),
      websites: websites(),
      bankAccounts: bankAccounts(),
    });

  const upsertMutation = mutations.create<Contact, void>({
    mutation: () => saveContact({ mode: props.mode, bookId: props.bookId, initialContact, payload: draftPayload() }),
    onSuccess: (contact) => afterSave({ mode: props.mode, bookId: props.bookId, onSaved: props.onSaved }, contact),
    onError: (error) => prompts.error(error.message),
  });

  const removeMutation = mutations.create<Contact | null, void>({
    mutation: () => deleteContact(props.bookId, initialContact),
    onSuccess: (contact) => afterDelete({ bookId: props.bookId, onDeleted: props.onDeleted }, contact),
    onError: (error) => prompts.error(error.message),
  });

  const handleDelete = async () => {
    if (!initialContact) return;
    removeMutation.mutate(undefined);
  };

  const handleCancel = () => {
    if (props.onCancel) {
      props.onCancel();
      return;
    }
    if (props.backHref) {
      navigateTo(props.backHref);
    }
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
    <PanelDialog>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelDialog.Header
          title={props.title ?? (props.mode === "create" ? "New Contact" : "Edit Contact")}
          subtitle={props.subtitle}
          icon={props.icon ?? (props.mode === "create" ? "ti ti-user-plus" : "ti ti-pencil")}
          close={handleCancel}
        />
        <PanelDialog.Body>
          <IdentitySection
            bookId={props.bookId}
            initialContact={initialContact}
            label={label}
            setLabel={setLabel}
            firstName={firstName}
            setFirstName={setFirstName}
            lastName={lastName}
            setLastName={setLastName}
            parentRef={parentRef}
            setParentRef={setParentRef}
            tagIds={tagIds}
            setTagIds={setTagIds}
            openParentPicker={openParentPicker}
          />
          <PersonalSection
            birthday={birthday}
            setBirthday={setBirthday}
            salutation={salutation}
            setSalutation={setSalutation}
            pronouns={pronouns}
            setPronouns={setPronouns}
            preferredLanguage={preferredLanguage}
            setPreferredLanguage={setPreferredLanguage}
          />
          <WorkSection
            companyName={companyName}
            setCompanyName={setCompanyName}
            vatId={vatId}
            setVatId={setVatId}
            department={department}
            setDepartment={setDepartment}
            jobTitle={jobTitle}
            setJobTitle={setJobTitle}
          />

          <ReachFields
            emails={emails}
            setEmails={setEmails}
            phones={phones}
            setPhones={setPhones}
            websites={websites}
            setWebsites={setWebsites}
          />

          <AddressFields rows={addresses} setRows={setAddresses} />

          <BankAccountFields rows={bankAccounts} setRows={setBankAccounts} />
        </PanelDialog.Body>

        <PanelDialog.Footer>
          <FooterContent
            mode={props.mode}
            backHref={props.backHref}
            onCancel={props.onCancel}
            saving={upsertMutation.loading()}
            deleting={removeMutation.loading()}
            onDelete={handleDelete}
            onSave={() => upsertMutation.mutate(undefined)}
          />
        </PanelDialog.Footer>
      </div>
    </PanelDialog>
  );
}
