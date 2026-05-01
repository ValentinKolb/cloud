import { createSignal, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { Contact, ContactRef } from "../../service";
import ContactSearchPicker from "./ContactSearchPicker.island";
import ContactUpsertForm from "./ContactUpsertForm.island";

type Props = {
  parent: Contact;
  /** Resolves with the saved/linked member, or null if cancelled. */
  close: (member: Contact | null) => void;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const errorMessage = async (res: Response, fallback: string) => {
  try {
    const data = (await res.json()) as unknown;
    if (isObject(data) && typeof data["message"] === "string" && data["message"].length > 0) {
      return data["message"];
    }
  } catch {}
  return fallback;
};

/**
 * Two-mode dialog for attaching a member to a parent contact:
 *
 *  - **pick**: search the parent's book and link an existing contact.
 *  - **create**: open the upsert form pre-filled with the parent reference.
 *
 * The server validates the cycle / same-book / self rules, so the picker only
 * has to exclude the parent itself client-side. Linking is a single PATCH.
 */
export default function AddMemberDialog(props: Props) {
  const [mode, setMode] = createSignal<"pick" | "create">("pick");

  const parentRef: ContactRef = {
    id: props.parent.id,
    label: props.parent.label,
    firstName: props.parent.firstName,
    lastName: props.parent.lastName,
    companyName: props.parent.companyName,
    jobTitle: props.parent.jobTitle,
  };

  const linkMutation = mutations.create<Contact, { contact: Contact }>({
    mutation: async (vars) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].$patch({
        param: { bookId: vars.contact.bookId, contactId: vars.contact.id },
        json: { parentContactId: props.parent.id },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to link member"));
      return (await res.json()) as Contact;
    },
    onSuccess: (linked) => props.close(linked),
    onError: (error) => prompts.error(error.message),
  });

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={mode() === "pick"}
        fallback={
          <ContactUpsertForm
            mode="create"
            bookId={props.parent.bookId}
            defaultParent={parentRef}
            onCancel={() => setMode("pick")}
            onSaved={(created) => props.close(created)}
          />
        }
      >
        <ContactSearchPicker
          bookId={props.parent.bookId}
          excludeIds={[props.parent.id]}
          placeholder="Search contacts in this book…"
          onSelect={(contact) => {
            if (linkMutation.loading()) return;
            linkMutation.mutate({ contact });
          }}
        />
        <div class="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button
            type="button"
            class="btn-simple btn-sm w-fit text-xs text-dimmed hover:text-primary"
            onClick={() => setMode("create")}
          >
            <i class="ti ti-plus" /> Create new contact as member
          </button>
        </div>
      </Show>
    </div>
  );
}
