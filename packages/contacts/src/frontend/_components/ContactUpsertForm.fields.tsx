import { PanelDialog, RemoveBtn, TextInput } from "@valentinkolb/cloud/ui";
import { Index } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import {
  EMPTY_ADDRESS,
  EMPTY_BANK_ACCOUNT,
  EMPTY_EMAIL,
  EMPTY_PHONE,
  EMPTY_WEBSITE,
  type EditableAddress,
  type EditableBankAccount,
  type EditableEmail,
  type EditablePhone,
  type EditableWebsite,
} from "./ContactUpsertForm.model";

type RowsProps<T> = {
  rows: Accessor<T[]>;
  setRows: Setter<T[]>;
};

const updateRow = <T,>(rows: T[], index: number, patch: Partial<T>): T[] =>
  rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));

export const ReachFields = (props: {
  emails: Accessor<EditableEmail[]>;
  setEmails: Setter<EditableEmail[]>;
  phones: Accessor<EditablePhone[]>;
  setPhones: Setter<EditablePhone[]>;
  websites: Accessor<EditableWebsite[]>;
  setWebsites: Setter<EditableWebsite[]>;
}) => (
  <PanelDialog.Section title="Reach" subtitle="Email, telephone, and website contact points." icon="ti ti-address-book">
    <div class="space-y-5">
      <div class="space-y-2">
        <Index each={props.emails()}>
          {(email, index) => (
            <div class="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
              <TextInput
                ariaLabel="Email label"
                placeholder="work, private..."
                value={() => email().label}
                onInput={(value) => props.setEmails((rows) => updateRow(rows, index, { label: value }))}
              />
              <TextInput
                ariaLabel="Email address"
                placeholder="name@company.com"
                icon="ti ti-mail text-blue-500 dark:text-blue-400"
                value={() => email().email}
                onInput={(value) => props.setEmails((rows) => updateRow(rows, index, { email: value }))}
              />
              <div class="flex items-center justify-end">
                <RemoveBtn ariaLabel="Remove email" onClick={() => props.setEmails((rows) => rows.filter((_, i) => i !== index))} />
              </div>
            </div>
          )}
        </Index>
        <button
          type="button"
          class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
          onClick={() => props.setEmails([...props.emails(), { ...EMPTY_EMAIL }])}
        >
          <i class="ti ti-plus" /> Add email
        </button>
      </div>

      <div class="space-y-2">
        <Index each={props.phones()}>
          {(phone, index) => (
            <div class="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
              <TextInput
                ariaLabel="Telephone label"
                placeholder="mobile, work..."
                value={() => phone().label}
                onInput={(value) => props.setPhones((rows) => updateRow(rows, index, { label: value }))}
              />
              <TextInput
                ariaLabel="Telephone number"
                placeholder="+49 151 12345678"
                icon="ti ti-phone text-green-600 dark:text-green-400"
                value={() => phone().phone}
                onInput={(value) => props.setPhones((rows) => updateRow(rows, index, { phone: value }))}
              />
              <div class="flex items-center justify-end">
                <RemoveBtn ariaLabel="Remove phone number" onClick={() => props.setPhones((rows) => rows.filter((_, i) => i !== index))} />
              </div>
            </div>
          )}
        </Index>
        <button
          type="button"
          class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
          onClick={() => props.setPhones([...props.phones(), { ...EMPTY_PHONE }])}
        >
          <i class="ti ti-plus" /> Add phone
        </button>
      </div>

      <div class="space-y-2">
        <Index each={props.websites()}>
          {(website, index) => (
            <div class="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
              <TextInput
                ariaLabel="Website label"
                placeholder="work, personal..."
                value={() => website().label}
                onInput={(value) => props.setWebsites((rows) => updateRow(rows, index, { label: value }))}
              />
              <TextInput
                ariaLabel="Website URL"
                placeholder="https://example.com"
                icon="ti ti-world text-purple-600 dark:text-purple-400"
                value={() => website().url}
                onInput={(value) => props.setWebsites((rows) => updateRow(rows, index, { url: value }))}
              />
              <div class="flex items-center justify-end">
                <RemoveBtn ariaLabel="Remove website" onClick={() => props.setWebsites((rows) => rows.filter((_, i) => i !== index))} />
              </div>
            </div>
          )}
        </Index>
        <button
          type="button"
          class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
          onClick={() => props.setWebsites([...props.websites(), { ...EMPTY_WEBSITE }])}
        >
          <i class="ti ti-plus" /> Add website
        </button>
      </div>
    </div>
  </PanelDialog.Section>
);

export const AddressFields = (props: RowsProps<EditableAddress>) => (
  <PanelDialog.Section title="Addresses" subtitle="Postal addresses with optional recipient and company details." icon="ti ti-map-pin">
    <div class="space-y-3">
      <Index each={props.rows()}>
        {(address, index) => (
          <div class="rounded-lg bg-zinc-200/60 p-3 dark:bg-zinc-800/40">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextInput
                label="Label"
                placeholder="e.g. office, home"
                icon="ti ti-tag"
                value={() => address().label}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { label: value }))}
              />
              <TextInput
                label="Recipient"
                placeholder="Max Mustermann"
                icon="ti ti-user"
                value={() => address().recipientName}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { recipientName: value }))}
              />
              <div class="md:col-span-2">
                <TextInput
                  label="Company"
                  placeholder="Example GmbH"
                  icon="ti ti-building"
                  value={() => address().companyName}
                  onInput={(value) => props.setRows((rows) => updateRow(rows, index, { companyName: value }))}
                />
              </div>
              <TextInput
                label="Address Line 1"
                placeholder="Musterstrasse 1"
                icon="ti ti-home"
                required
                value={() => address().line1}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { line1: value }))}
              />
              <TextInput
                label="Address Line 2"
                placeholder="c/o, floor, etc. (optional)"
                icon="ti ti-home"
                value={() => address().line2}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { line2: value }))}
              />
              <TextInput
                label="Postal Code"
                placeholder="89073"
                icon="ti ti-map-pin"
                required
                value={() => address().postalCode}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { postalCode: value }))}
              />
              <TextInput
                label="City"
                placeholder="Ulm"
                icon="ti ti-building-community"
                required
                value={() => address().city}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { city: value }))}
              />
              <TextInput
                label="State / Region"
                placeholder="Baden-Wuerttemberg"
                description="Optional. US state or other region."
                icon="ti ti-map-2"
                value={() => address().stateRegion}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { stateRegion: value }))}
              />
              <TextInput
                label="Country Code"
                placeholder="DE"
                description="ISO 2-letter, e.g. DE, AT, CH."
                icon="ti ti-flag"
                value={() => address().countryCode}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { countryCode: value }))}
              />
            </div>
            <div class="mt-4 flex justify-end">
              <button
                type="button"
                class="btn-simple btn-sm text-xs text-dimmed hover:text-red-600 dark:hover:text-red-400"
                onClick={() => props.setRows((rows) => rows.filter((_, i) => i !== index))}
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
        onClick={() => props.setRows([...props.rows(), { ...EMPTY_ADDRESS }])}
      >
        <i class="ti ti-plus" /> Add address
      </button>
    </div>
  </PanelDialog.Section>
);

export const BankAccountFields = (props: RowsProps<EditableBankAccount>) => (
  <PanelDialog.Section title="Bank Details" subtitle="Banking information for billing, refunds, and payouts." icon="ti ti-building-bank">
    <div class="space-y-3">
      <Index each={props.rows()}>
        {(account, index) => (
          <div class="rounded-lg bg-zinc-200/60 p-3 dark:bg-zinc-800/40">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <TextInput
                label="Label"
                placeholder="e.g. billing, refunds"
                icon="ti ti-tag"
                value={() => account().label}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { label: value }))}
              />
              <TextInput
                label="Account Holder"
                placeholder="Max Mustermann"
                icon="ti ti-user"
                required
                value={() => account().accountHolderName}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { accountHolderName: value }))}
              />
              <TextInput
                label="IBAN"
                placeholder="DE02120300000000202051"
                icon="ti ti-credit-card"
                required
                value={() => account().iban}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { iban: value }))}
              />
              <TextInput
                label="BIC"
                placeholder="BYLADEM1001"
                icon="ti ti-building-bank"
                value={() => account().bic}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { bic: value }))}
              />
              <TextInput
                label="Bank Name"
                placeholder="Example Bank"
                icon="ti ti-building-bank"
                value={() => account().bankName}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { bankName: value }))}
              />
              <TextInput
                label="Note"
                placeholder="Optional"
                icon="ti ti-notes"
                value={() => account().note}
                onInput={(value) => props.setRows((rows) => updateRow(rows, index, { note: value }))}
              />
            </div>
            <div class="mt-4 flex justify-end">
              <button
                type="button"
                class="btn-simple btn-sm text-xs text-dimmed hover:text-red-600 dark:hover:text-red-400"
                onClick={() => props.setRows((rows) => rows.filter((_, i) => i !== index))}
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
        onClick={() => props.setRows([...props.rows(), { ...EMPTY_BANK_ACCOUNT }])}
      >
        <i class="ti ti-plus" /> Add bank details
      </button>
    </div>
  </PanelDialog.Section>
);
