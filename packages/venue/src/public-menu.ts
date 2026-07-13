import { PublicMenuItemSchema, type PublicSection } from "./contracts";

export const isPublicMenuItemAvailable = (item: unknown, date: string): boolean => {
  const parsed = PublicMenuItemSchema.safeParse(item);
  if (!parsed.success) return false;
  if (parsed.data.availableFrom && date < parsed.data.availableFrom) return false;
  if (parsed.data.availableUntil && date > parsed.data.availableUntil) return false;
  return true;
};

export const filterPublicMenuSections = (sections: PublicSection[], date: string): PublicSection[] =>
  sections.flatMap((section) => {
    if (section.kind !== "menu") return [section];
    const items = Array.isArray(section.content.items) ? section.content.items : [];
    const availableItems = items.filter((item) => isPublicMenuItemAvailable(item, date));
    return availableItems.length > 0
      ? [
          {
            ...section,
            content: {
              ...section.content,
              items: availableItems,
            },
          },
        ]
      : [];
  });
