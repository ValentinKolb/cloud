export const mailboxHealthMessage = (health: string): string => {
  if (health === "paused") return "Mailbox synchronization is paused. Resume it in Settings.";
  if (health === "degraded" || health === "authentication_failed") {
    return "This mailbox connection needs attention. Check its provider settings.";
  }
  return "Mailbox synchronization is temporarily unavailable. Try again shortly or check Settings.";
};
