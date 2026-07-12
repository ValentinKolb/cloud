import { prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactRef } from "../../service";
import { resolveContactName } from "../../shared";
import { readErrorMessage } from "./api";
import ContactSearchPicker from "./ContactSearchPicker";
import ContactTagsPicker from "./ContactTagsPicker";
import { buildContactPayload, contactToUpsertDraft } from "./ContactUpsertForm.model";

type Props = {
  contact: Contact;
  onCancel: () => void;
  onSaved: (contact: Contact) => void;
  onEditAll: () => void;
};

const toContactRef = (contact: Contact): ContactRef => ({
  id: contact.id,
  label: contact.label,
  firstName: contact.firstName,
  lastName: contact.lastName,
  companyName: contact.companyName,
  jobTitle: contact.jobTitle,
});

/** Focused editor for the fields users change most often on a record page. */
export default function ContactQuickEdit(props: Props) {
  const initial = contactToUpsertDraft(props.contact);
  const [label, setLabel] = createSignal(initial.label);
  const [firstName, setFirstName] = createSignal(initial.firstName);
  const [lastName, setLastName] = createSignal(initial.lastName);
  const [companyName, setCompanyName] = createSignal(initial.companyName);
  const [jobTitle, setJobTitle] = createSignal(initial.jobTitle);
  const [email, setEmail] = createSignal(initial.emails[0]?.email ?? "");
  const [phone, setPhone] = createSignal(initial.phones[0]?.phone ?? "");
  const [parentRef, setParentRef] = createSignal<ContactRef | null>(initial.parentRef);
  const [tagIds, setTagIds] = createSignal(initial.tagIds);

  const saveMutation = mutations.create<Contact, void>({
    mutation: async () => {
      const draft = contactToUpsertDraft(props.contact);
      const emails = [...draft.emails];
      const phones = [...draft.phones];
      emails[0] = { label: emails[0]?.label ?? "Email", email: email() };
      phones[0] = { label: phones[0]?.label ?? "Telephone", phone: phone() };

      const response = await apiClient.books[":bookId"].contacts[":contactId"].$patch({
        param: { bookId: props.contact.bookId, contactId: props.contact.id },
        json: buildContactPayload({
          ...draft,
          label: label(),
          firstName: firstName(),
          lastName: lastName(),
          companyName: companyName(),
          jobTitle: jobTitle(),
          emails,
          phones,
          parentRef: parentRef(),
          tagIds: tagIds(),
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update contact"));
      return await response.json();
    },
    onSuccess: (contact) => {
      toast.success("Contact updated");
      props.onSaved(contact);
    },
    onError: (error) => prompts.error(error.message),
  });

  const openParentPicker = async () => {
    const picked = await prompts.dialog<Contact | null>(
      (close) => (
        <ContactSearchPicker bookId={props.contact.bookId} excludeIds={[props.contact.id]} onSelect={(contact) => close(contact)} />
      ),
      {
        title: "Pick a parent contact",
        icon: "ti ti-corner-down-right",
        size: "medium",
      },
    );
    if (picked) setParentRef(toContactRef(picked));
  };

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate(undefined);
      }}
    >
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput label="First name" value={firstName} onInput={setFirstName} autocomplete="given-name" />
        <TextInput label="Last name" value={lastName} onInput={setLastName} autocomplete="family-name" />
        <div class="sm:col-span-2">
          <TextInput label="Display name" description="Optional. Falls back to first and last name." value={label} onInput={setLabel} />
        </div>
        <TextInput label="Company" value={companyName} onInput={setCompanyName} autocomplete="organization" />
        <TextInput label="Job title" value={jobTitle} onInput={setJobTitle} autocomplete="organization-title" />
        <TextInput label="Primary email" type="email" value={email} onInput={setEmail} autocomplete="email" />
        <TextInput label="Primary phone" type="tel" value={phone} onInput={setPhone} autocomplete="tel" />
      </div>

      <div class="grid gap-4 border-t border-[var(--ui-divider)] pt-4 sm:grid-cols-2">
        <div>
          <span class="text-label mb-1.5 block text-xs">Organization</span>
          <Show
            when={parentRef()}
            fallback={
              <button type="button" class="btn-simple btn-sm" onClick={openParentPicker}>
                <i class="ti ti-corner-down-right" /> Choose parent
              </button>
            }
          >
            {(parent) => (
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="rounded-md bg-[var(--ui-surface-subtle)] px-2 py-1 text-xs text-primary">{resolveContactName(parent())}</span>
                <button type="button" class="btn-simple btn-sm" onClick={openParentPicker}>
                  Change
                </button>
                <button type="button" class="btn-simple btn-sm text-dimmed" onClick={() => setParentRef(null)}>
                  Clear
                </button>
              </div>
            )}
          </Show>
        </div>
        <div>
          <span class="text-label mb-1.5 block text-xs">Tags</span>
          <ContactTagsPicker
            bookId={props.contact.bookId}
            selectedIds={tagIds()}
            onChange={setTagIds}
            manageUrl={`/app/contacts/${props.contact.bookId}/settings`}
            compact
          />
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ui-divider)] pt-3">
        <button type="button" class="btn-simple btn-sm text-dimmed" onClick={props.onEditAll}>
          Edit all fields <i class="ti ti-arrow-up-right" />
        </button>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-secondary btn-sm" onClick={props.onCancel} disabled={saveMutation.loading()}>
            Cancel
          </button>
          <button type="submit" class="btn-primary btn-sm" disabled={saveMutation.loading()}>
            {saveMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-check" />}
            Save
          </button>
        </div>
      </div>
    </form>
  );
}
