import { documentNavigate } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, dialogCore, IconButton, MultiSelectInput, PanelDialog, panelDialogOptions, prompts, Tooltip, toast } from "@k2b/ui";
import { createSignal, onCleanup } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactTag } from "../../service";
import { readErrorMessage } from "./api";

type BookOption = { id: string; name: string };

type BulkIntent =
  | { action: "tags"; bookId: string; contactIds: string[]; tagIds: string[] }
  | { action: "move"; bookId: string; contactIds: string[]; targetBookId: string }
  | { action: "export"; bookId: string; contactIds: string[] }
  | { action: "delete"; bookId: string; contactIds: string[] };

type BulkResult = { action: "tags" | "move" | "delete"; contactCount: number } | { action: "export"; blob: Blob };

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
  const [preparing, setPreparing] = createSignal(false);
  let disposed = false;

  const runMutation = mutations.create<BulkResult, BulkIntent>({
    mutation: async (intent, { abortSignal }) => {
      if (intent.action === "tags") {
        const response = await apiClient.books[":bookId"].contacts.bulk.tags.$post(
          {
            param: { bookId: intent.bookId },
            json: { contactIds: intent.contactIds, tagIds: intent.tagIds },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readErrorMessage(response, "Could not add tags"));
        return { action: "tags", contactCount: intent.contactIds.length };
      }

      if (intent.action === "move") {
        const response = await apiClient.books[":bookId"].contacts.bulk.move.$post(
          {
            param: { bookId: intent.bookId },
            json: { contactIds: intent.contactIds, targetBookId: intent.targetBookId },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readErrorMessage(response, "Could not move contacts"));
        return { action: "move", contactCount: intent.contactIds.length };
      }

      if (intent.action === "export") {
        const response = await apiClient.books[":bookId"].contacts.bulk["export.vcf"].$post(
          {
            param: { bookId: intent.bookId },
            json: { contactIds: intent.contactIds },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readErrorMessage(response, "Could not export contacts"));
        return { action: "export", blob: await response.blob() };
      }

      const response = await apiClient.books[":bookId"].contacts.bulk.delete.$post(
        {
          param: { bookId: intent.bookId },
          json: { contactIds: intent.contactIds },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not delete contacts"));
      return { action: "delete", contactCount: intent.contactIds.length };
    },
    onSuccess: (result) => {
      if (result.action === "export") {
        saveBlob(result.blob, "contacts-selection.vcf");
        return;
      }

      if (result.action === "tags") {
        toast.success(`Tags added to ${result.contactCount} contact${result.contactCount === 1 ? "" : "s"}`);
      } else if (result.action === "move") {
        toast.success(`${result.contactCount} contact${result.contactCount === 1 ? "" : "s"} moved`);
      } else {
        toast.success(`${result.contactCount} contact${result.contactCount === 1 ? "" : "s"} deleted`);
      }

      props.onClear();
      void Promise.resolve()
        .then(() => props.onChanged())
        .catch(() => {
          documentNavigate(`${window.location.pathname}${window.location.search}`, { replace: true });
        });
    },
    onError: (error) => void prompts.error(error.message),
  });

  onCleanup(() => {
    disposed = true;
    runMutation.abort();
  });

  const prepare = async (action: BulkIntent["action"]) => {
    if (preparing() || runMutation.loading()) return;
    const bookId = props.bookId;
    const contactIds = [...props.selectedIds()];
    if (contactIds.length === 0) return;
    const tags = [...props.tags];
    const writableBooks = [...props.writableBooks];

    setPreparing(true);
    try {
      if (action === "tags") {
        if (tags.length === 0) {
          await prompts.alert("Create a tag in book settings before assigning tags.", {
            title: "No tags available",
            icon: "ti ti-tags-off",
          });
          return;
        }
        const tagIds = await chooseTags(tags);
        if (tagIds && !disposed) void runMutation.mutate({ action, bookId, contactIds, tagIds: [...tagIds] });
        return;
      }

      if (action === "move") {
        const targets = writableBooks.filter((book) => book.id !== bookId);
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
        if (result && !disposed) void runMutation.mutate({ action, bookId, contactIds, targetBookId: result.targetBookId });
        return;
      }

      if (action === "delete") {
        const confirmed = await prompts.confirm(
          `Permanently delete ${contactIds.length} selected contact${contactIds.length === 1 ? "" : "s"}? Notes and contact details will also be deleted.`,
          { title: "Delete contacts", icon: "ti ti-trash", confirmText: "Delete", variant: "danger" },
        );
        if (confirmed && !disposed) void runMutation.mutate({ action, bookId, contactIds });
        return;
      }

      if (!disposed) void runMutation.mutate({ action, bookId, contactIds });
    } catch (error) {
      if (!disposed) void prompts.error(error instanceof Error ? error.message : "Could not prepare bulk action");
    } finally {
      if (!disposed) setPreparing(false);
    }
  };

  const noSelection = () => props.selectedIds().length === 0;
  const busy = () => preparing() || runMutation.loading();

  return (
    <div class="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-selected)] p-2">
      <span class="mr-auto text-xs font-medium text-primary tabular-nums">{props.selectedIds().length} selected</span>
      <Button variant="ghost" size="sm" onClick={props.onSelectVisible} disabled={props.visibleIds().length === 0}>
        Select page
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void prepare("tags")} disabled={busy() || noSelection()}>
        <i class="ti ti-tags" /> Tag
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void prepare("move")} disabled={busy() || noSelection()}>
        <i class="ti ti-folder-symlink" /> Move
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void prepare("export")} disabled={busy() || noSelection()}>
        <i class="ti ti-download" /> Export
      </Button>
      <Button variant="danger" size="sm" onClick={() => void prepare("delete")} disabled={busy() || noSelection()}>
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
