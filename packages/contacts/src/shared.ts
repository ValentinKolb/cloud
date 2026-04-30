type NameLike = {
  label?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  emails?: Array<{ email: string }> | null;
  phones?: Array<{ phone: string }> | null;
};

const trimOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveContactName = (contact: NameLike): string => {
  const fullName = [trimOrNull(contact.firstName), trimOrNull(contact.lastName)].filter(Boolean).join(" ");
  return (
    trimOrNull(contact.label) ??
    trimOrNull(fullName) ??
    trimOrNull(contact.companyName) ??
    trimOrNull(contact.emails?.[0]?.email) ??
    trimOrNull(contact.phones?.[0]?.phone) ??
    "Unnamed contact"
  );
};

export const resolveStoredContactLabel = (contact: NameLike): string | null => {
  return trimOrNull(contact.label);
};
