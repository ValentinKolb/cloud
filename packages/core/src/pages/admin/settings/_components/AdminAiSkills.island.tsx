/**
 * Admin page for workspace-owned reusable Assistant instructions.
 */
import { SettingsPage } from "@k2b/ui";
import { AiSkillsManagerBody } from "@valentinkolb/cloud/ai/ui";

export default function AdminAiSkills(props: { title: string; subtitle: string; icon: string }) {
  return (
    <SettingsPage title={props.title} subtitle={props.subtitle} icon={props.icon}>
      <AiSkillsManagerBody isAdmin />
    </SettingsPage>
  );
}
