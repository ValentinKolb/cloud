import { navigateTo, PanelDialog, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactRef } from "../../service";
import { resolveContactName } from "../../shared";
import ContactSearchPicker from "./ContactSearchPicker.island";
import ContactTagsPicker from "./ContactTagsPicker.island";
import { AddressFields, BankAccountFields, ReachFields } from "./ContactUpsertForm.fields";
import {
  type EditableAddress,
  type EditableBankAccount,
  type EditableEmail,
  type EditablePhone,
  type EditableWebsite,
  buildContactPayload,
  initialAddressRows,
  initialBankAccountRows,
  initialEmailRows,
  initialPhoneRows,
  initialWebsiteRows,
} from "./ContactUpsertForm.model";
import { readErrorMessage } from "./api";

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
      const payload = buildContactPayload({
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

      if (props.mode === "create") {
        const response = await apiClient.books[":bookId"].contacts.$post({
          param: { bookId: props.bookId },
          json: payload,
        });

        if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create contact"));

        const created = await response.json();
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

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update contact"));

      return await response.json();
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

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete contact"));

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
          <PanelDialog.Section title="Identity" subtitle="Name, parent contact, and book tags." icon="ti ti-id">
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
                      <button
                        type="button"
                        class="btn-simple btn-sm text-xs text-dimmed hover:text-red-500"
                        onClick={() => setParentRef(null)}
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
          </PanelDialog.Section>

          <PanelDialog.Section title="Personal" subtitle="Optional personal profile details." icon="ti ti-user-heart">
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
          </PanelDialog.Section>

          <PanelDialog.Section title="Work" subtitle="Company, role, department, and billing identifiers." icon="ti ti-briefcase">
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
          </PanelDialog.Section>

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
          <div class="flex w-full flex-wrap items-center justify-between gap-2">
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
        </PanelDialog.Footer>
      </div>
    </PanelDialog>
  );
}
