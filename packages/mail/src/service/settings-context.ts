import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { MailboxSettingsContext } from "../settings-context";
import * as mailboxAccess from "./access";
import type { MailRequestContext } from "./auth";
import * as bindings from "./bindings";
import * as collaboration from "./collaboration";
import * as composeTemplates from "./compose-templates";
import * as health from "./health";
import * as localTags from "./local-tags";
import * as mailboxes from "./mailboxes";
import * as messages from "./messages";
import * as providerConnections from "./provider-connections";
import * as savedViews from "./saved-views";
import * as senderIdentities from "./sender-identities";

export const loadMailboxSettingsContext = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<MailboxSettingsContext>> => {
  const permission = await mailboxAccess.getMailboxPermission(context, mailboxId);
  if (permission === "none") return fail(err.forbidden("Access denied"));

  const mailboxResult = await mailboxes.getMailbox(context, mailboxId);
  if (!mailboxResult.ok) return fail(mailboxResult.error);
  const [savedViewResult, localTagResult, organizationFolderResult, assignableUserResult] = await Promise.all([
    savedViews.listSavedConversationViews({ context, mailboxId }),
    localTags.listLocalTags(context, mailboxId),
    messages.listFolders(context, mailboxId),
    collaboration.listAssignableUsers({ context, mailboxId, limit: 200 }),
  ]);
  if (!savedViewResult.ok) return fail(savedViewResult.error);
  if (!localTagResult.ok) return fail(localTagResult.error);
  if (!organizationFolderResult.ok) return fail(organizationFolderResult.error);
  if (!assignableUserResult.ok) return fail(assignableUserResult.error);
  const organization = {
    savedViews: savedViewResult.data,
    localTags: localTagResult.data,
    folders: organizationFolderResult.data,
    assignableUsers: assignableUserResult.data,
  };

  let compose: MailboxSettingsContext["compose"] = null;
  if (permission === "write" || permission === "admin") {
    const [templateResult, defaultResult, styleResult, identityResult] = await Promise.all([
      composeTemplates.listComposeTemplates(context, mailboxId),
      composeTemplates.listComposeSignatureDefaults(context, mailboxId),
      composeTemplates.getMailboxComposeStyle(context, mailboxId),
      senderIdentities.listSenderIdentities(context, mailboxId),
    ]);
    if (!templateResult.ok) return fail(templateResult.error);
    if (!defaultResult.ok) return fail(defaultResult.error);
    if (!styleResult.ok) return fail(styleResult.error);
    if (!identityResult.ok) return fail(identityResult.error);
    compose = {
      templates: templateResult.data,
      defaults: defaultResult.data,
      style: styleResult.data,
      identities: identityResult.data,
    };
  }

  if (permission !== "admin") return ok({ mailbox: mailboxResult.data, permission, organization, compose, admin: null });

  const [accessResult, connectionResult, bindingResult, healthResult, identityResult] = await Promise.all([
    mailboxAccess.listMailboxAccess(context, mailboxId),
    providerConnections.listProviderConnections(context, mailboxId),
    bindings.listProviderBindings(context, mailboxId),
    health.getMailboxOperationalHealth(context, mailboxId),
    senderIdentities.listSenderIdentities(context, mailboxId),
  ]);
  if (!accessResult.ok) return fail(accessResult.error);
  if (!connectionResult.ok) return fail(connectionResult.error);
  if (!bindingResult.ok) return fail(bindingResult.error);
  if (!healthResult.ok) return fail(healthResult.error);
  if (!identityResult.ok) return fail(identityResult.error);
  return ok({
    mailbox: mailboxResult.data,
    permission,
    organization,
    compose,
    admin: {
      accessEntries: accessResult.data,
      connections: connectionResult.data,
      bindings: bindingResult.data,
      folders: organizationFolderResult.data,
      health: healthResult.data,
      identities: identityResult.data,
    },
  });
};
