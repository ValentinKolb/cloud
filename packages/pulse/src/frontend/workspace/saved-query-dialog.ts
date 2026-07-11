import { prompts } from "@valentinkolb/cloud/ui";
import type { PulseExplorerQuery } from "../../contracts";
import {
  defaultSavedQueryName,
  normalizeSavedQueryDialogResult,
  type SavedQueryDialogResult,
} from "./saved-query-dialog-model";

export const openSaveQueryDialog = async (compiled: PulseExplorerQuery | null): Promise<SavedQueryDialogResult | null> => {
  const result = await prompts.form({
    title: "Save query",
    icon: "ti ti-device-floppy",
    fields: {
      name: { type: "text", label: "Name", required: true, placeholder: defaultSavedQueryName(compiled) },
      description: {
        type: "text",
        label: "Description",
        multiline: true,
        lines: 3,
        placeholder: "Optional notes for this query",
      },
    },
    confirmText: "Save",
  });
  return normalizeSavedQueryDialogResult(result);
};
