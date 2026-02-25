import type { SpaceItem } from "@/spaces/contracts";

export type KanbanBucketInitial = {
  key: string;
  label: string;
  color: string | null;
  kind: "column" | "completed";
  columnId: string | null;
  items: SpaceItem[];
  page: number;
  totalPages: number;
  total: number;
};
