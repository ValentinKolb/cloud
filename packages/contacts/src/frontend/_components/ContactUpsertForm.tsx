import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, ButtonLink, PanelDialog, prompts, TextInput, toast } from "@k2b/ui";
import { type Accessor, createSignal, onCleanup, type Setter, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactRef } from "../../service";
import { resolveContactName } from "../../shared";
import { readErrorMessage } from "./api";
import { openBookSettingsDialog } from "./BookSettingsDialog";
import ContactSearchPicker from "./ContactSearchPicker";
import ContactTagsPicker from "./ContactTagsPicker";
import { AddressFields, BankAccountFields, ReachFields } from "./ContactUpsertForm.fields";
import {
  buildContactPayload,
  type ContactUpsertInitialValues,
  contactToUpsertDraft,
  createContactUpsertDraft,
  type EditableAddress,
  type EditableBankAccount,
  type EditableEmail,
  type EditablePhone,
  type EditableWebsite,
  EMPTY_ADDRESS,
  EMPTY_BANK_ACCOUNT,
} from "./ContactUpsertForm.model";

type ContactUpsertMode = "create" | "edit";

type Props = {
  mode: ContactUpsertMode;
  bookId: string;
  initialContact?: Contact | null;
  initialValues?: ContactUpsertInitialValues;
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
      <TextInput label="First Name" placeholder="Max" icon="ti ti-user" value={props.firstName} onValueChange={props.setFirstName} />
      <TextInput label="Last Name" placeholder="Mustermann" icon="ti ti-user" value={props.lastName} onValueChange={props.setLastName} />
      <div class="md:col-span-2">
        <TextInput
          label="Nickname"
          placeholder="e.g. Alex"
          description="Shown as the primary name in lists and the detail header. Falls back to first + last name when empty."
          icon="ti ti-user"
          value={props.label}
          onValueChange={props.setLabel}
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
            <Button variant="ghost" size="xs" class="w-fit text-xs text-dimmed hover:text-primary" onClick={props.openParentPicker}>
              <i class="ti ti-corner-down-right" /> Pick a parent contact
            </Button>
          }
        >
          {(parent) => (
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                <i class="ti ti-corner-down-right text-[10px]" />
                {resolveContactName(parent())}
              </span>
              <Button variant="ghost" size="xs" class="text-xs text-dimmed hover:text-primary" onClick={props.openParentPicker}>
                Change
              </Button>
              <Button variant="ghost" size="xs" class="text-xs text-dimmed hover:text-red-500" onClick={() => props.setParentRef(null)}>
                Clear
              </Button>
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
          onManage={async () => (await openBookSettingsDialog({ bookId: props.bookId, initialTab: "tags" })).workspaceChanged}
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
      <TextInput label="Birthday" placeholder="1990-01-31" icon="ti ti-cake" value={props.birthday} onValueChange={props.setBirthday} />
      <TextInput
        label="Salutation / Title"
        placeholder="Dr., Prof., Ms., Mr."
        icon="ti ti-id-badge-2"
        value={props.salutation}
        onValueChange={props.setSalutation}
      />
      <TextInput
        label="Pronouns"
        placeholder="she/her, he/him, they/them"
        icon="ti ti-user-heart"
        value={props.pronouns}
        onValueChange={props.setPronouns}
      />
      <TextInput
        label="Preferred Language"
        placeholder="de, en, fr"
        icon="ti ti-language"
        value={props.preferredLanguage}
        onValueChange={props.setPreferredLanguage}
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
        onValueChange={props.setCompanyName}
      />
      <TextInput
        label="VAT ID"
        placeholder="DE123456789"
        description="Country prefix + ID, e.g. DE123456789."
        icon="ti ti-receipt-2"
        value={props.vatId}
        onValueChange={props.setVatId}
      />
      <TextInput
        label="Department"
        placeholder="Sales"
        icon="ti ti-hierarchy"
        value={props.department}
        onValueChange={props.setDepartment}
      />
      <TextInput
        label="Job Title"
        placeholder="Account Manager"
        icon="ti ti-briefcase"
        value={props.jobTitle}
        onValueChange={props.setJobTitle}
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
        <Button
          variant="danger"
          size="sm"
          aria-label="Delete contact"
          disabled={props.saving || props.deleting}
          loading={props.deleting}
          onClick={props.onDelete}
        >
          <i class="ti ti-trash" />
          Delete
        </Button>
      )}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Show
        when={props.backHref}
        fallback={
          <Show when={props.onCancel}>
            <Button variant="secondary" size="sm" onClick={() => props.onCancel?.()}>
              Cancel
            </Button>
          </Show>
        }
      >
        <ButtonLink href={props.backHref!} variant="secondary" size="sm">
          Cancel
        </ButtonLink>
      </Show>
      <Button
        size="sm"
        aria-label={props.mode === "create" ? "Create contact" : "Save contact changes"}
        disabled={props.saving || props.deleting}
        loading={props.saving}
        onClick={props.onSave}
      >
        <i class={props.mode === "create" ? "ti ti-plus" : "ti ti-device-floppy"} />
        {props.mode === "create" ? "Create Contact" : "Save Changes"}
      </Button>
    </div>
  </div>
);

type SaveContactConfig = {
  mode: ContactUpsertMode;
  bookId: string;
  contactId?: string;
  payload: ReturnType<typeof buildContactPayload>;
};

const saveContact = async (config: SaveContactConfig, abortSignal: AbortSignal): Promise<Contact> => {
  if (config.mode === "create") {
    const response = await apiClient.books[":bookId"].contacts.$post(
      {
        param: { bookId: config.bookId },
        json: config.payload,
      },
      { init: { signal: abortSignal } },
    );
    if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create contact"));
    return await response.json();
  }

  if (!config.contactId) throw new Error("Missing contact data for edit mode");
  const response = await apiClient.books[":bookId"].contacts[":contactId"].$patch(
    {
      param: {
        bookId: config.bookId,
        contactId: config.contactId,
      },
      json: config.payload,
    },
    { init: { signal: abortSignal } },
  );
  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update contact"));
  return await response.json();
};

const deleteContact = async (intent: { bookId: string; contact: Contact }, abortSignal: AbortSignal): Promise<Contact> => {
  const response = await apiClient.books[":bookId"].contacts[":contactId"].$delete(
    {
      param: {
        bookId: intent.bookId,
        contactId: intent.contact.id,
      },
    },
    { init: { signal: abortSignal } },
  );
  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete contact"));
  return intent.contact;
};

const afterSave = (config: { mode: ContactUpsertMode; bookId: string; onSaved?: (contact: Contact) => void }, contact: Contact) => {
  toast.success(config.mode === "create" ? "Contact created" : "Contact updated");
  if (config.onSaved) {
    config.onSaved(contact);
    return;
  }
  navigateTo(detailHref(config.bookId, contact.id));
};

const afterDelete = (config: { bookId: string; onDeleted?: () => void }, contact: Contact) => {
  toast.success("Contact deleted");
  if (config.onDeleted) {
    config.onDeleted();
    return;
  }
  navigateTo(`/app/contacts/${config.bookId}`);
};

const contactParent = (contact: Contact | null, defaultParent: ContactRef | null | undefined): ContactRef | null =>
  contact?.parent ?? defaultParent ?? null;

const createContactFormState = (
  initialContact: Contact | null,
  defaultParent: ContactRef | null | undefined,
  initialValues: ContactUpsertInitialValues | undefined,
) => {
  const draft = initialContact ? contactToUpsertDraft(initialContact) : createContactUpsertDraft(initialValues);
  const [label, setLabel] = createSignal(draft.label);
  const [firstName, setFirstName] = createSignal(draft.firstName);
  const [lastName, setLastName] = createSignal(draft.lastName);
  const [companyName, setCompanyName] = createSignal(draft.companyName);
  const [department, setDepartment] = createSignal(draft.department);
  const [jobTitle, setJobTitle] = createSignal(draft.jobTitle);
  const [vatId, setVatId] = createSignal(draft.vatId);
  const [websites, setWebsites] = createSignal<EditableWebsite[]>(draft.websites);
  const [bankAccounts, setBankAccounts] = createSignal<EditableBankAccount[]>(draft.bankAccounts);
  const [birthday, setBirthday] = createSignal(draft.birthday);
  const [salutation, setSalutation] = createSignal(draft.salutation);
  const [pronouns, setPronouns] = createSignal(draft.pronouns);
  const [preferredLanguage, setPreferredLanguage] = createSignal(draft.preferredLanguage);
  const [parentRef, setParentRef] = createSignal<ContactRef | null>(contactParent(initialContact, defaultParent));
  const [tagIds, setTagIds] = createSignal<string[]>(draft.tagIds);
  const [emails, setEmails] = createSignal<EditableEmail[]>(draft.emails);
  const [phones, setPhones] = createSignal<EditablePhone[]>(draft.phones);
  const [addresses, setAddresses] = createSignal<EditableAddress[]>(draft.addresses);

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
  const form = createContactFormState(initialContact, props.defaultParent, props.initialValues);
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
  const [showPersonal, setShowPersonal] = createSignal(
    Boolean(initialContact?.birthday || initialContact?.salutation || initialContact?.pronouns || initialContact?.preferredLanguage),
  );
  const [showWork, setShowWork] = createSignal(
    Boolean(initialContact?.companyName || initialContact?.department || initialContact?.jobTitle || initialContact?.vatId),
  );
  const [showAddresses, setShowAddresses] = createSignal((initialContact?.addresses.length ?? 0) > 0);
  const [showBankAccounts, setShowBankAccounts] = createSignal(bankAccounts().length > 0);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  let disposed = false;

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

  const upsertMutation = mutations.create<Contact, SaveContactConfig>({
    mutation: (intent, { abortSignal }) => saveContact(intent, abortSignal),
    onSuccess: (contact) => afterSave({ mode: props.mode, bookId: props.bookId, onSaved: props.onSaved }, contact),
    onError: (error) => prompts.error(error.message),
  });

  const removeMutation = mutations.create<Contact, { bookId: string; contact: Contact }>({
    mutation: (intent, { abortSignal }) => deleteContact(intent, abortSignal),
    onSuccess: (contact) => afterDelete({ bookId: props.bookId, onDeleted: props.onDeleted }, contact),
    onError: (error) => prompts.error(error.message),
  });

  onCleanup(() => {
    disposed = true;
    upsertMutation.abort();
    removeMutation.abort();
  });

  const handleDelete = async () => {
    if (!initialContact || confirmingDelete() || removeMutation.loading()) return;
    const intent = { bookId: props.bookId, contact: initialContact };
    setConfirmingDelete(true);
    try {
      const confirmed = await prompts.confirm(`Delete "${resolveContactName(intent.contact)}"? This cannot be undone.`, {
        title: "Delete Contact",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (confirmed && !disposed) void removeMutation.mutate(intent);
    } catch (error) {
      if (!disposed) void prompts.error(error instanceof Error ? error.message : "Could not confirm contact deletion");
    } finally {
      if (!disposed) setConfirmingDelete(false);
    }
  };

  const handleSave = () => {
    try {
      const payload = draftPayload();
      void upsertMutation.mutate({
        mode: props.mode,
        bookId: props.bookId,
        contactId: initialContact?.id,
        payload: { ...payload, tagIds: [...(payload.tagIds ?? [])] },
      });
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Failed to prepare contact");
    }
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
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-contacts-editor="true">
        <PanelDialog.Header
          title={props.title ?? (props.mode === "create" ? "New Contact" : "Edit Contact")}
          subtitle={props.subtitle}
          icon={props.icon ?? (props.mode === "create" ? "ti ti-user-plus" : "ti ti-pencil")}
          close={handleCancel}
        />
        <PanelDialog.Body>
          <IdentitySection
            bookId={props.bookId}
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
          <ReachFields
            emails={emails}
            setEmails={setEmails}
            phones={phones}
            setPhones={setPhones}
            websites={websites}
            setWebsites={setWebsites}
          />
          <div class="flex flex-wrap items-center gap-2">
            <Show when={!showPersonal()}>
              <Button variant="ghost" size="sm" onClick={() => setShowPersonal(true)}>
                <i class="ti ti-user-heart" /> Add personal details
              </Button>
            </Show>
            <Show when={!showWork()}>
              <Button variant="ghost" size="sm" onClick={() => setShowWork(true)}>
                <i class="ti ti-briefcase" /> Add work details
              </Button>
            </Show>
            <Show when={!showAddresses()}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddresses(true);
                  if (addresses().length === 0) setAddresses([{ ...EMPTY_ADDRESS }]);
                }}
              >
                <i class="ti ti-map-pin" /> Add address
              </Button>
            </Show>
            <Show when={!showBankAccounts()}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowBankAccounts(true);
                  if (bankAccounts().length === 0) setBankAccounts([{ ...EMPTY_BANK_ACCOUNT }]);
                }}
              >
                <i class="ti ti-building-bank" /> Add bank details
              </Button>
            </Show>
          </div>
          <Show when={showPersonal()}>
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
          </Show>
          <Show when={showWork()}>
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
          </Show>
          <Show when={showAddresses()}>
            <AddressFields rows={addresses} setRows={setAddresses} />
          </Show>
          <Show when={showBankAccounts()}>
            <BankAccountFields rows={bankAccounts} setRows={setBankAccounts} />
          </Show>
        </PanelDialog.Body>

        <PanelDialog.Footer>
          <FooterContent
            mode={props.mode}
            backHref={props.backHref}
            onCancel={props.onCancel}
            saving={upsertMutation.loading()}
            deleting={confirmingDelete() || removeMutation.loading()}
            onDelete={handleDelete}
            onSave={handleSave}
          />
        </PanelDialog.Footer>
      </div>
    </PanelDialog>
  );
}
