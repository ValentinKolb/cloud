import type { z } from "zod";
import type {
  PublicCreateDocumentLinkResponseSchema,
  PublicDocumentLinkListResponseSchema,
  PublicDocumentLinkSchema,
  PublicDocumentRunBrowseResponseSchema,
  PublicDocumentRunSummarySchema,
  PublicDocumentTemplateSchema,
  PublicDocumentTemplateSummarySchema,
  PublicRecordSnapshotSchema,
  PublicRecordSnapshotSummarySchema,
} from "../../../api/documents-api-shared";

export type PublicDocumentTemplate = z.infer<typeof PublicDocumentTemplateSchema>;
export type PublicDocumentTemplateSummary = z.infer<typeof PublicDocumentTemplateSummarySchema>;
export type PublicDocumentRunSummary = z.infer<typeof PublicDocumentRunSummarySchema>;
export type PublicDocumentRunBrowseResponse = z.infer<typeof PublicDocumentRunBrowseResponseSchema>;
export type PublicDocumentRunFolder = z.infer<typeof PublicDocumentRunBrowseResponseSchema>["folders"][number];
export type PublicDocumentLink = z.infer<typeof PublicDocumentLinkSchema>;
export type PublicDocumentLinkListResponse = z.infer<typeof PublicDocumentLinkListResponseSchema>;
export type PublicCreateDocumentLinkResponse = z.infer<typeof PublicCreateDocumentLinkResponseSchema>;
export type PublicRecordSnapshot = z.infer<typeof PublicRecordSnapshotSchema>;
export type PublicRecordSnapshotSummary = z.infer<typeof PublicRecordSnapshotSummarySchema>;
