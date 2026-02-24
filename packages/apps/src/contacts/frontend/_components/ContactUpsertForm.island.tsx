import { createSignal, Index, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { RemoveBtn } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/contacts/client";
import type { Contact } from "../../service";

type ContactUpsertMode = "create" | "edit";

type Props = {
  mode: ContactUpsertMode;
  bookId: string;
  initialContact?: Contact | null;
  backHref: string;
};

type EditableEmail = { label: string; email: string };
type EditablePhone = { label: string; phone: string };
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
const DEFAULT_ADDRESS_LABEL = "Address";

const EMPTY_EMAIL: EditableEmail = {
  label: DEFAULT_EMAIL_LABEL,
  email: "",
};

const EMPTY_PHONE: EditablePhone = {
  label: DEFAULT_PHONE_LABEL,
  phone: "",
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

const detailHref = (bookId: string, contactId: string) => `/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}`;
const sectionTitleClass = "text-sm font-semibold text-primary";

/**
 * Shared contact upsert form (create + edit) for manual books.
 */
export default function ContactUpsertForm(props: Props) {
  const initialContact = props.mode === "edit" ? (props.initialContact ?? null) : null;

  const [displayName, setDisplayName] = createSignal(initialContact?.displayName ?? "");
  const [firstName, setFirstName] = createSignal(initialContact?.firstName ?? "");
  const [lastName, setLastName] = createSignal(initialContact?.lastName ?? "");
  const [companyName, setCompanyName] = createSignal(initialContact?.companyName ?? "");
  const [department, setDepartment] = createSignal(initialContact?.department ?? "");
  const [jobTitle, setJobTitle] = createSignal(initialContact?.jobTitle ?? "");
  const [vatId, setVatId] = createSignal(initialContact?.vatId ?? "");
  const [website, setWebsite] = createSignal(initialContact?.website ?? "");
  const [birthday, setBirthday] = createSignal(initialContact?.birthday ?? "");
  const [note, setNote] = createSignal(initialContact?.note ?? "");

  const [emails, setEmails] = createSignal<EditableEmail[]>(initialEmailRows(initialContact));
  const [phones, setPhones] = createSignal<EditablePhone[]>(initialPhoneRows(initialContact));
  const [addresses, setAddresses] = createSignal<EditableAddress[]>(initialAddressRows(initialContact));

  const upsertMutation = mutations.create<string, void>({
    mutation: async () => {
      const trimmedDisplayName = displayName().trim();
      if (!trimmedDisplayName) {
        throw new Error("Display name is required");
      }

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
        displayName: trimmedDisplayName,
        firstName: firstName().trim() || null,
        lastName: lastName().trim() || null,
        companyName: companyName().trim() || null,
        department: department().trim() || null,
        jobTitle: jobTitle().trim() || null,
        vatId: vatId().trim() || null,
        website: website().trim() || null,
        birthday: birthdayValue || null,
        note: note().trim() || null,
        emails: normalizedEmails,
        phones: normalizedPhones,
        addresses: normalizedAddresses,
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
        return created.id;
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

      return initialContact.id;
    },
    onSuccess: (contactId) => {
      window.location.href = detailHref(props.bookId, contactId);
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  const removeMutation = mutations.create<void, void>({
    mutation: async () => {
      if (!initialContact) {
        throw new Error("Missing contact data for delete");
      }

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
    },
    onSuccess: () => {
      window.location.href = `/app/contacts/${props.bookId}`;
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  const handleDelete = async () => {
    if (!initialContact) return;

    const confirmed = await prompts.confirm(`Delete "${initialContact.displayName}"? This cannot be undone.`, {
      title: "Delete Contact",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
      cancelText: "Cancel",
    });

    if (!confirmed) return;
    removeMutation.mutate(undefined);
  };

  return (
    <div class="space-y-6">
      <section class="space-y-3">
        <h2 class={sectionTitleClass}>General</h2>

        <div class="paper p-4 space-y-5">
          <div class="space-y-3">
            <h3 class="text-xs text-dimmed">Identity</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextInput
                label="Display Name"
                placeholder="Max Mustermann"
                icon="ti ti-user"
                required
                value={displayName}
                onInput={setDisplayName}
              />
              <TextInput label="Website" placeholder="https://example.com" icon="ti ti-world" value={website} onInput={setWebsite} />
              <TextInput label="First Name" placeholder="Max" icon="ti ti-user" value={firstName} onInput={setFirstName} />
              <TextInput label="Last Name" placeholder="Mustermann" icon="ti ti-user" value={lastName} onInput={setLastName} />
            </div>
          </div>

          <div class="space-y-3">
            <h3 class="text-xs text-dimmed">Business</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextInput label="Company" placeholder="Example GmbH" icon="ti ti-building" value={companyName} onInput={setCompanyName} />
              <TextInput label="VAT ID" placeholder="DE123456789" icon="ti ti-receipt-2" value={vatId} onInput={setVatId} />
              <TextInput label="Department" placeholder="Sales" icon="ti ti-hierarchy" value={department} onInput={setDepartment} />
              <TextInput label="Job Title" placeholder="Account Manager" icon="ti ti-briefcase" value={jobTitle} onInput={setJobTitle} />
            </div>
          </div>

          <div class="space-y-3">
            <h3 class="text-xs text-dimmed">Additional</h3>
            <TextInput label="Birthday" placeholder="1990-01-31" icon="ti ti-cake" value={birthday} onInput={setBirthday} />
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class={sectionTitleClass}>Emails</h2>
          <button type="button" class="btn-secondary btn-sm" onClick={() => setEmails([...emails(), { ...EMPTY_EMAIL }])}>
            <i class="ti ti-plus" />
            Add
          </button>
        </div>

        <div class="paper p-4 space-y-3">
          <Show when={emails().length > 0} fallback={<p class="text-xs text-dimmed">No emails configured.</p>}>
            <Index each={emails()}>
              {(email, index) => (
              <div class="grid grid-cols-1 md:grid-cols-[190px_1fr_auto] gap-2 items-center">
                <TextInput
                  ariaLabel="Email label"
                  placeholder="Label (optional)"
                  icon="ti ti-tag"
                  value={() => email().label}
                  onInput={(value) => setEmails((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)))}
                />
                <TextInput
                  ariaLabel="Email address"
                  placeholder="name@company.com"
                  icon="ti ti-mail"
                  value={() => email().email}
                  onInput={(value) => setEmails((current) => current.map((row, i) => (i === index ? { ...row, email: value } : row)))}
                />
                <div class="flex items-center justify-end">
                  <RemoveBtn ariaLabel="Remove email" onClick={() => setEmails((current) => current.filter((_, i) => i !== index))} />
                </div>
              </div>
              )}
            </Index>
          </Show>
        </div>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class={sectionTitleClass}>Telephones</h2>
          <button type="button" class="btn-secondary btn-sm" onClick={() => setPhones([...phones(), { ...EMPTY_PHONE }])}>
            <i class="ti ti-plus" />
            Add
          </button>
        </div>

        <div class="paper p-4 space-y-3">
          <Show when={phones().length > 0} fallback={<p class="text-xs text-dimmed">No phone numbers configured.</p>}>
            <Index each={phones()}>
              {(phone, index) => (
              <div class="grid grid-cols-1 md:grid-cols-[190px_1fr_auto] gap-2 items-center">
                <TextInput
                  ariaLabel="Telephone label"
                  placeholder="Label (optional)"
                  icon="ti ti-tag"
                  value={() => phone().label}
                  onInput={(value) => setPhones((current) => current.map((row, i) => (i === index ? { ...row, label: value } : row)))}
                />
                <TextInput
                  ariaLabel="Telephone number"
                  placeholder="+49 151 12345678"
                  icon="ti ti-phone"
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
          </Show>
        </div>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class={sectionTitleClass}>Addresses</h2>
          <button type="button" class="btn-secondary btn-sm" onClick={() => setAddresses([...addresses(), { ...EMPTY_ADDRESS }])}>
            <i class="ti ti-plus" />
            Add
          </button>
        </div>

        <Show when={addresses().length > 0} fallback={<p class="text-xs text-dimmed">No addresses configured.</p>}>
          <div class="space-y-3">
            <Index each={addresses()}>
              {(address, index) => (
              <article class="paper p-4 space-y-3">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <TextInput
                    label="Label"
                    placeholder="Address (optional)"
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
                    icon="ti ti-map-2"
                    value={() => address().stateRegion}
                    onInput={(value) =>
                      setAddresses((current) => current.map((row, i) => (i === index ? { ...row, stateRegion: value } : row)))
                    }
                  />
                  <TextInput
                    label="Country Code"
                    placeholder="DE"
                    icon="ti ti-flag"
                    value={() => address().countryCode}
                    onInput={(value) =>
                      setAddresses((current) => current.map((row, i) => (i === index ? { ...row, countryCode: value } : row)))
                    }
                  />
                </div>

                <div class="pt-1">
                  <button
                    type="button"
                    class="btn-danger btn-sm"
                    onClick={() => setAddresses((current) => current.filter((_, i) => i !== index))}
                  >
                    <i class="ti ti-trash" />
                    Delete Address
                  </button>
                </div>
              </article>
              )}
            </Index>
          </div>
        </Show>
      </section>

      <section class="space-y-3">
        <h2 class={sectionTitleClass}>Note</h2>
        <TextInput icon="ti ti-notes" multiline placeholder="Optional internal notes for this contact..." value={note} onInput={setNote} />
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
          <a href={props.backHref} class="btn-secondary btn-sm">
            Cancel
          </a>
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
