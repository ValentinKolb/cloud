import { type CapabilityCaller, getCapabilityCatalogApp, invokeCapabilityWithDataSchema } from "@valentinkolb/cloud/capabilities/server";
import {
  type CloudResourceView,
  CloudResourceViewSchema,
  cloudResourceRefAppId,
  resolveCapabilityResourceReader,
} from "@valentinkolb/cloud/contracts";
import { z } from "zod";
import type { SpaceItemResourceReference } from "@/contracts";

export type ItemResourceReferenceView = SpaceItemResourceReference & { resource: CloudResourceView | null };

export const resolveReferenceViews = async (
  references: SpaceItemResourceReference[],
  caller: CapabilityCaller,
): Promise<ItemResourceReferenceView[]> =>
  Promise.all(
    references.map(async (reference) => {
      const appId = cloudResourceRefAppId(reference.ref);
      const catalog = await getCapabilityCatalogApp(appId);
      const app = catalog.ok ? catalog.data : null;
      const reader = app ? resolveCapabilityResourceReader(app.manifest, reference.ref) : null;
      if (!reader) return { ...reference, resource: null };
      const result = await invokeCapabilityWithDataSchema(
        { appId, capabilityId: reader.localId, kind: "query", input: { id: reference.ref.id } },
        z.unknown(),
        caller,
      );
      if (!result.ok || !result.data.links?.length) return { ...reference, resource: null };
      const localType = reference.ref.type.slice(appId.length + 1);
      const type = app?.manifest.types.find((candidate) => candidate.localId === localType);
      const resource = CloudResourceViewSchema.parse({
        ref: reference.ref,
        title: reference.label,
        icon: type?.icon,
        links: result.data.links,
      });
      return { ...reference, resource };
    }),
  );
