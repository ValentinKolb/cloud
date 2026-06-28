import { buildNoteUrl } from "../../../params";
import { navigateToNotebookNote } from "../../../lib/soft-navigation";
import { openNoteSearchPrompt } from "./openNoteSearchPrompt";

type Props = {
  notebookId: string;
  notebookName: string;
  variant?: "compact" | "chip" | "sidebar" | "sidebar-mobile" | "icon";
};

export default function SearchButton(props: Props) {
  const handleSearch = async () => {
    const picked = await openNoteSearchPrompt(props.notebookId, props.notebookName);
    if (picked) {
      void navigateToNotebookNote(buildNoteUrl(props.notebookId, picked.shortId));
    }
  };

  if (props.variant === "compact") {
    return (
      <button
        type="button"
        onClick={handleSearch}
        class="p-0.5 text-dimmed hover:text-primary transition-colors"
        title="Search notes (Mod+Shift+K)"
      >
        <i class="ti ti-search text-xs" />
      </button>
    );
  }

  if (props.variant === "icon") {
    return (
      <button type="button" onClick={handleSearch} class="sidebar-icon-action" title="Search notes (Mod+Shift+K)" aria-label="Search notes">
        <i class="ti ti-search text-base" />
      </button>
    );
  }

  if (props.variant === "chip") {
    return (
      <button
        type="button"
        onClick={handleSearch}
        class="btn-input btn-input-sm bg-zinc-200/60 dark:bg-zinc-800/60"
        title="Search notes (Mod+Shift+K)"
      >
        <i class="ti ti-search" />
        <span>Search</span>
      </button>
    );
  }

  if (props.variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={handleSearch}
        class="sidebar-item w-full min-h-8 px-2 py-1.5 text-xs"
        title="Search notes (Mod+Shift+K)"
      >
        <i class="ti ti-search" />
        <span>Search</span>
      </button>
    );
  }

  if (props.variant === "sidebar-mobile") {
    return (
      <button type="button" onClick={handleSearch} class="sidebar-item-mobile w-full" title="Search notes (Mod+Shift+K)">
        <i class="ti ti-search" />
        <span>Search</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleSearch}
      class="flex items-center gap-2 text-xs text-dimmed hover:text-primary transition-colors px-2 py-1.5"
      title="Search notes (Mod+Shift+K)"
    >
      <i class="ti ti-search text-sm" />
      <span>Search</span>
    </button>
  );
}
