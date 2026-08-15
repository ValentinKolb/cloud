import type { Field } from "../contracts";
import type { CustomAppCapabilities, CustomAppFormBlock, CustomAppPage, CustomAppSidebarAction } from "../custom-apps/contracts";
import { customAppFormInlineTargetTableIds } from "../custom-apps/form-capability";
import { customAppFormMatchesPublishedCapability } from "../custom-apps/form-runtime";
import { listByTable } from "./fields";
import { get as getForm } from "./forms";

type PublishedFormSurface = CustomAppFormBlock | Extract<CustomAppSidebarAction, { kind: "form" }>;

export const resolvePublishedCustomAppForm = async (input: {
  surface: PublishedFormSurface;
  page?: CustomAppPage;
  capabilities: CustomAppCapabilities;
}) => {
  const capability = input.page
    ? input.capabilities.forms.find(
        (candidate) =>
          "pageId" in candidate &&
          candidate.pageId === input.page!.id &&
          candidate.blockId === input.surface.id &&
          candidate.formId === input.surface.formId,
      )
    : input.capabilities.forms.find(
        (candidate) =>
          "sidebarActionId" in candidate && candidate.sidebarActionId === input.surface.id && candidate.formId === input.surface.formId,
      );
  if (!capability) return null;
  const form = await getForm(input.surface.formId);
  if (!form) return null;
  const fields = await listByTable(form.tableId, true);
  const inlineTargetFields: Field[] = (
    await Promise.all(customAppFormInlineTargetTableIds(form.config, fields).map((tableId) => listByTable(tableId, true)))
  ).flat();
  if (
    !customAppFormMatchesPublishedCapability({
      block: input.surface,
      page: input.page,
      form,
      fields,
      inlineTargetFields,
      capability,
    })
  ) {
    return null;
  }
  return { form, fields, inlineTargetFields } as const;
};
