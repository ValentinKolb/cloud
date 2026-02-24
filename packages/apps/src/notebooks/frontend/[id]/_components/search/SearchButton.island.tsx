import { prompts } from "@valentinkolb/cloud/lib/ui";
import { buildNoteUrl } from "../../../params";
import NoteSearch from "./NoteSearch.island";

type Props = {
  notebookId: string;
  variant?: "compact";
};

export default function SearchButton(props: Props) {
  const handleSearch = async () => {
    const noteId = await prompts.dialog<string>((close) => <NoteSearch notebookId={props.notebookId} close={close} />, {
      title: "Search Pages",
      icon: "ti ti-search",
    });

    if (noteId) {
      window.location.href = buildNoteUrl(props.notebookId, noteId);
    }
  };

  if (props.variant === "compact") {
    return (
      <button type="button" onClick={handleSearch} class="p-0.5 text-dimmed hover:text-primary transition-colors" title="Search pages">
        <i class="ti ti-search text-xs" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleSearch}
      class="flex items-center gap-2 text-xs text-dimmed hover:text-primary transition-colors px-2 py-1.5"
      title="Search pages"
    >
      <i class="ti ti-search text-sm" />
      <span>Search</span>
    </button>
  );
}
