import { createHash } from "node:crypto";
import type { AppRegistryHelpSummary, HelpRegistryEntry } from "../contracts/registry";
import type { HelpDefinition } from "../server/help";
import type { HelpDocumentManifest } from "../shared/help";

export const HELP_REGISTRY_MAX_BYTES = 512 * 1024;
export const HELP_DOCUMENT_MAX_BYTES = 128 * 1024;

export type CompiledHelp = {
  summary: AppRegistryHelpSummary;
  registryEntry: HelpRegistryEntry;
};

const serializedBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const helpHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const normalizedBasePath = (basePath: string | undefined): string => {
  const value = basePath?.replace(/\/$/, "") ?? "";
  return value || "";
};

export const compileHelp = (input: {
  appId: string;
  appName: string;
  appIcon: string;
  basePath?: string;
  definition: HelpDefinition;
}): CompiledHelp => {
  const appId = encodeURIComponent(input.appId);
  const pageBase = `${normalizedBasePath(input.basePath)}/help`;
  const searchUrl = `/api/help/v1/${appId}/search`;
  const documents = input.definition.documents.map(({ id, title, icon, description, order, markdown, searchText }) => {
    const markdownBytes = new TextEncoder().encode(markdown).byteLength;
    if (markdownBytes > HELP_DOCUMENT_MAX_BYTES) {
      throw new Error(`Help document "${id}" exceeds the ${HELP_DOCUMENT_MAX_BYTES}-byte limit`);
    }
    return { id, title, icon, description, order, markdown, searchText };
  });
  const manifestHash = helpHash({ appId: input.appId, documents });
  const manifest = documents.map<HelpDocumentManifest>(({ id, title, icon, description, order }) => ({
    id,
    title,
    icon,
    description,
    order,
    searchUrl,
    url: `/api/help/v1/${appId}/documents/${encodeURIComponent(id)}`,
  }));
  const registryEntry: HelpRegistryEntry = {
    appId: input.appId,
    appName: input.appName,
    appIcon: input.appIcon,
    manifestHash,
    documents,
  };
  const bytes = serializedBytes(registryEntry);
  if (bytes > HELP_REGISTRY_MAX_BYTES) {
    throw new Error(`Help corpus exceeds the ${HELP_REGISTRY_MAX_BYTES}-byte registry limit`);
  }
  return {
    summary: { manifestHash, pageBase, documents: manifest },
    registryEntry,
  };
};
