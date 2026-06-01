import { dialogCore, navigateTo, panelDialogOptions, prompts, refreshCurrentPath, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Accessor, Setter } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactRef, ContactTree, ContactTreeNode } from "../../service";
import { resolveContactName } from "../../shared";
import AddMemberDialog from "./AddMemberDialog.island";
import ContactUpsertForm from "./ContactUpsertForm.island";
import { readErrorMessage } from "./api";
import { setSelectedContactInUrl } from "./context";

export const createContactDetailActions = (config: {
  bookId: Accessor<string | null>;
  writableBooks: Array<{ id: string; name: string }>;
  orgTree: Accessor<ContactTree | null>;
  setOrgTree: Setter<ContactTree | null>;
  setDetailMode: Setter<"details" | "tree">;
}) => {
  const canEdit = () => {
    const selectedBookId = config.bookId();
    if (!selectedBookId || selectedBookId === "system") return false;
    return config.writableBooks.some((entry) => entry.id === selectedBookId);
  };

  const canMove = () => {
    const selectedBookId = config.bookId();
    if (!selectedBookId || selectedBookId === "system") return false;
    return config.writableBooks.some((entry) => entry.id !== selectedBookId);
  };

  const moveMutation = mutations.create<Contact | null, Contact>({
    mutation: async (contact) => {
      const targetOptions = config.writableBooks.filter((entry) => entry.id !== contact.bookId);
      if (targetOptions.length === 0) {
        await prompts.alert("There is no other writable contact book available.", {
          title: "No target book",
          icon: "ti ti-address-book-off",
        });
        return null;
      }

      const result = await prompts.form({
        title: "Move Contact",
        icon: "ti ti-arrows-transfer-up-down",
        confirmText: "Move",
        fields: {
          targetBookId: {
            type: "select",
            label: "Move this contact to which book?",
            required: true,
            options: targetOptions.map((entry) => ({
              id: entry.id,
              label: entry.name,
              icon: "ti ti-address-book",
            })),
          },
        },
      });
      if (!result) return null;

      const response = await apiClient.books[":bookId"].contacts[":contactId"].move.$post({
        param: {
          bookId: contact.bookId,
          contactId: contact.id,
        },
        json: { targetBookId: result.targetBookId },
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to move contact"));

      return await response.json();
    },
    onSuccess: (moved) => {
      if (!moved) return;
      toast.success("Contact moved");
      navigateTo(`/app/contacts/${moved.bookId}?contact=${moved.id}&contactBook=${moved.bookId}`);
    },
    onError: (error) => {
      void prompts.error(error.message);
    },
  });

  const unlinkMemberMutation = mutations.create<ContactRef | null, { member: ContactRef; parent: Contact }>({
    mutation: async ({ member, parent }) => {
      const confirmed = await prompts.confirm(
        `Remove "${resolveContactName(member)}" from members of "${resolveContactName(parent)}"? The contact stays - only the link is removed.`,
        {
          title: "Remove member",
          icon: "ti ti-unlink",
          confirmText: "Remove",
          cancelText: "Cancel",
        },
      );
      if (!confirmed) return null;

      const res = await apiClient.books[":bookId"].contacts[":contactId"].$patch({
        param: { bookId: parent.bookId, contactId: member.id },
        json: { parentContactId: null },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to remove member"));
      return member;
    },
    onSuccess: (member) => {
      if (!member) return;
      toast.success("Member removed");
      refreshCurrentPath();
    },
    onError: (error) => {
      void prompts.error(error.message);
    },
  });

  const orgTreeMutation = mutations.create<ContactTree, Contact>({
    mutation: async (selectedContact) => {
      const response = await apiClient.books[":bookId"].contacts[":contactId"].tree.$get({
        param: { bookId: selectedContact.bookId, contactId: selectedContact.id },
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load org tree"));

      return await response.json();
    },
    onSuccess: (tree) => {
      config.setOrgTree(tree);
      config.setDetailMode("tree");
    },
    onError: (error) => {
      void prompts.error(error.message);
    },
  });

  const openAddMemberDialog = async (parent: Contact) => {
    const member = await dialogCore.open<Contact | null>((close) => <AddMemberDialog parent={parent} close={close} />, panelDialogOptions);
    if (!member) return;
    refreshCurrentPath();
  };

  const openEditDialog = async (selectedContact: Contact) => {
    const updated = await dialogCore.open<Contact | undefined>(
      (close) => (
        <ContactUpsertForm
          mode="edit"
          bookId={selectedContact.bookId}
          initialContact={selectedContact}
          title={`Edit ${resolveContactName(selectedContact)}`}
          icon="ti ti-pencil"
          onCancel={() => close(undefined)}
          onSaved={(contact) => close(contact)}
        />
      ),
      panelDialogOptions,
    );

    if (!updated) return;
    setSelectedContactInUrl({
      contactId: updated.id,
      bookId: updated.bookId,
      contact: updated,
    });
  };

  const selectOrgTreeNode = async (node: ContactTreeNode, fallbackBookId: string) => {
    const selectedBookId = config.orgTree()?.bookId ?? fallbackBookId;
    const response = await apiClient.books[":bookId"].contacts[":contactId"].$get({
      param: { bookId: selectedBookId, contactId: node.id },
    });

    if (!response.ok) {
      void prompts.error(await readErrorMessage(response, "Failed to load contact"));
      return;
    }

    const selected = await response.json();
    setSelectedContactInUrl({ contactId: selected.id, bookId: selected.bookId, contact: selected });
  };

  return {
    canEdit,
    canMove,
    moveToBook: (contact: Contact) => moveMutation.mutate(contact),
    unlinkMember: (member: ContactRef, parent: Contact) => unlinkMemberMutation.mutate({ member, parent }),
    openOrgTree: (contact: Contact) => {
      if (orgTreeMutation.loading()) return;
      orgTreeMutation.mutate(contact);
    },
    orgTreeLoading: orgTreeMutation.loading,
    openAddMemberDialog,
    openEditDialog,
    selectOrgTreeNode,
  };
};
