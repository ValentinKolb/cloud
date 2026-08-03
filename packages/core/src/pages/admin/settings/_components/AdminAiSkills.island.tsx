/**
 * Admin page for the workspace skill catalog — the same manager body the
 * assistant modal uses, in admin mode: global enable switches, code review
 * queue, and the durable audit log. Personal skills stay out of here.
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
