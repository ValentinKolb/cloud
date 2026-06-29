import { SpotlightButton, SPOTLIGHT_SHORTCUT_TITLE, type SpotlightButtonVariant } from "@valentinkolb/cloud/ui";
import { buildNoteUrl } from "../../../params";
import { navigateToNotebookNote } from "../../../lib/soft-navigation";
import { openNoteSearchPrompt } from "./openNoteSearchPrompt";

type Props = {
  notebookId: string;
  notebookName: string;
  variant?: SpotlightButtonVariant;
};

export default function SearchButton(props: Props) {
  const handleSearch = async () => {
    const picked = await openNoteSearchPrompt(props.notebookId, props.notebookName);
    if (picked) {
      void navigateToNotebookNote(buildNoteUrl(props.notebookId, picked.shortId));
    }
  };

  return (
    <SpotlightButton
      variant={props.variant}
      onClick={handleSearch}
      title={`Search notes (${SPOTLIGHT_SHORTCUT_TITLE})`}
      ariaLabel="Search notes"
    />
  );
}
