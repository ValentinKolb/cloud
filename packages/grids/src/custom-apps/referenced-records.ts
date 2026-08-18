import { gqlFieldRef, gqlSourceRef } from "../query-dsl/source-format";
import type { CustomAppPage, CustomAppRecordsBlock, CustomAppReferencedRecordsBlock } from "./contracts";

export type CustomAppRecordsLikeBlock = CustomAppRecordsBlock | CustomAppReferencedRecordsBlock;

export const referencedRecordsGqlSource = (page: CustomAppPage, block: CustomAppReferencedRecordsBlock): string | null => {
  const parameterId = page.record?.id.path;
  if (!parameterId) return null;
  return [
    `from ${gqlSourceRef("table", block.sourceTableId)}`,
    `select ${block.fieldIds.map(gqlFieldRef).join(", ")}`,
    `where oneof(${gqlFieldRef(block.relationFieldId)}, @params.${parameterId})`,
  ].join("\n");
};
