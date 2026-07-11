import type { PanesValue } from "@valentinkolb/cloud/ui";

export const createListDetailPanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "pulse-list-detail-root",
    direction: "horizontal",
    sizes: [68, 32],
    children: [
      {
        type: "leaf",
        id: "list",
        elementIds: ["list"],
        activeElementId: "list",
        presentation: "single",
      },
      {
        type: "leaf",
        id: "detail",
        elementIds: ["detail"],
        activeElementId: "detail",
        presentation: "single",
      },
    ],
  },
});
