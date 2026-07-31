export const buildSpacesEventHandoffHref = (params: { origin: string; spaceId: string; mailboxId: string; messageId: string }) => {
  const target = new URL(`/app/spaces/${params.spaceId}`, params.origin);
  target.searchParams.set("create", "event");
  target.searchParams.set("mailbox", params.mailboxId);
  target.searchParams.set("message", params.messageId);
  return `${target.pathname}${target.search}`;
};
