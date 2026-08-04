import { documentNavigate } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, dialogCore, IconButton, MultiSelectInput, PanelDialog, panelDialogOptions, prompts, Tooltip, toast } from "@k2b/ui";
import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactTag } from "../../service";
import { readErrorMessage } from "./api";

type BookOption = { id: string; name: string };

const saveBlob = (blob: Blob, filename: string) => {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
};

const chooseTags = (tags: ContactTag[]) =>
  dialogCore.open<string[] | null>((close) => {
    const [selected, setSelected] = createSignal<string[]>([]);
    return (
      <PanelDialog>
        <PanelDialog.Header title="Add tags" subtitle="Existing contact tags stay unchanged." icon="ti ti-tags" close={() => close(null)} />
        <PanelDialog.Body>
          <MultiSelectInput
            label="Tags"
            placeholder="Choose tags"
            icon="ti ti-tags"
            value={selected}
            onValueChange={setSelected}
            options={tags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
            clearable
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => close(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={selected().length === 0} onClick={() => close(selected())}>
              Add tags
            </Button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);

export default function ContactsBulkActions(props: {
  bookId: string;
  selectedIds: () => string[];
  visibleIds: () => string[];
  tags: ContactTag[];
  writableBooks: BookOption[];
  onSelectVisible: () => void;
  onClear: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const runMutation = mutations.create<void, "tags" | "move" | "export" | "delete">({
    mutation: async (action) => {
      const contactIds = props.selectedIds();
      if (contactIds.length === 0) return;

      if (action === "tags") {
        if (props.tags.length === 0) {
          await prompts.alert("Create a tag in book settings before assigning tags.", {
            title: "No tags available",
            icon: "ti ti-tags-off",
          });
          return;
        }
        const tagIds = await chooseTags(props.tags);
        if (!tagIds) return;
        const response = await apiClient.books[":bookId"].contacts.bulk.tags.$post({
          param: { bookId: props.bookId },
          json: { contactIds, tagIds },
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, "Could not add tags"));
        toast.success(`Tags added to ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}`);
      }

      if (action === "move") {
        const targets = props.writableBooks.filter((book) => book.id !== props.bookId);
        if (targets.length === 0) {
          await prompts.alert("There is no other writable contact book.", { title: "No target book", icon: "ti ti-folder-off" });
          return;
        }
        const result = await prompts.form({
          title: `Move ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}`,
          icon: "ti ti-folder-symlink",
          confirmText: "Move",
          fields: {
            targetBookId: {
              type: "select",
              label: "Target book",
              description: "Book-scoped tags and links to contacts outside this selection are removed.",
              required: true,
              options: targets.map((book) => ({ id: book.id, label: book.name, icon: "ti ti-address-book" })),
            },
          },
        });
        if (!result) return;
        const response = await apiClient.books[":bookId"].contacts.bulk.move.$post({
          param: { bookId: props.bookId },
          json: { contactIds, targetBookId: result.targetBookId },
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, "Could not move contacts"));
        toast.success(`${contactIds.length} contact${contactIds.length === 1 ? "" : "s"} moved`);
      }

      if (action === "export") {
        const response = await apiClient.books[":bookId"].contacts.bulk["export.vcf"].$post({
          param: { bookId: props.bookId },
          json: { contactIds },
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, "Could not export contacts"));
        saveBlob(await response.blob(), "contacts-selection.vcf");
        return;
      }

      if (action === "delete") {
        const confirmed = await prompts.confirm(
          `Permanently delete ${contactIds.length} selected contact${contactIds.length === 1 ? "" : "s"}? Notes and contact details will also be deleted.`,
          { title: "Delete contacts", icon: "ti ti-trash", confirmText: "Delete", variant: "danger" },
        );
        if (!confirmed) return;
        const response = await apiClient.books[":bookId"].contacts.bulk.delete.$post({
          param: { bookId: props.bookId },
          json: { contactIds },
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, "Could not delete contacts"));
        toast.success(`${contactIds.length} contact${contactIds.length === 1 ? "" : "s"} deleted`);
      }

      props.onClear();
      try {
        await props.onChanged();
      } catch {
        documentNavigate(`${window.location.pathname}${window.location.search}`, { replace: true });
      }
    },
    onError: (error) => void prompts.error(error.message),
  });

  const noSelection = () => props.selectedIds().length === 0;

  return (
    <div class="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-selected)] p-2">
      <span class="mr-auto text-xs font-medium text-primary tabular-nums">{props.selectedIds().length} selected</span>
      <Button variant="ghost" size="sm" onClick={props.onSelectVisible} disabled={props.visibleIds().length === 0}>
        Select page
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void runMutation.mutate("tags")} disabled={runMutation.loading() || noSelection()}>
        <i class="ti ti-tags" /> Tag
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void runMutation.mutate("move")} disabled={runMutation.loading() || noSelection()}>
        <i class="ti ti-folder-symlink" /> Move
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void runMutation.mutate("export")} disabled={runMutation.loading() || noSelection()}>
        <i class="ti ti-download" /> Export
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={() => void runMutation.mutate("delete")}
        disabled={runMutation.loading() || noSelection()}
      >
        <i class="ti ti-trash" /> Delete
      </Button>
      <Tooltip.Anchor content="Exit selection">
        <IconButton size="xs" label="Exit selection" onClick={props.onClear}>
          <i class="ti ti-x" />
        </IconButton>
      </Tooltip.Anchor>
    </div>
  );
}
