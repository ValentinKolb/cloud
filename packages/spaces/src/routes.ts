export const buildSpaceItemHref = (spaceId: string, itemId: string): string => `/app/spaces/${spaceId}?item=${itemId}`;

export const buildSpaceCalendarUid = (itemId: string): string => `${itemId}@spaces.cloud`;
