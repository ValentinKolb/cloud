export const MAIL_AUTOMATION_SECTIONS = ["overview", "automatic-replies", "sender-rules", "workflows", "references"] as const;

export type MailAutomationSection = (typeof MAIL_AUTOMATION_SECTIONS)[number];
export type MailAutomationAdminSection = Extract<MailAutomationSection, "sender-rules" | "workflows" | "references">;

const ADMIN_SECTIONS = new Set<MailAutomationSection>(["sender-rules", "workflows", "references"]);

export const isMailAutomationSection = (value: string): value is MailAutomationSection =>
  MAIL_AUTOMATION_SECTIONS.some((section) => section === value);

export const isMailAutomationAdminSection = (value: MailAutomationSection): value is MailAutomationAdminSection =>
  ADMIN_SECTIONS.has(value);

export const resolveMailAutomationSection = (value: string | null | undefined, advanced: boolean): MailAutomationSection => {
  if (!value || !isMailAutomationSection(value)) return "overview";
  return isMailAutomationAdminSection(value) && !advanced ? "overview" : value;
};
