/**
 * Admin page for the workspace skill catalog — the same manager body the
 * assistant modal uses, in admin mode: global enable switches, code review
 * queue, and the durable audit log. Personal skills stay out of here.
 */
import { AiSkillsManagerBody, PanelDialog } from "@valentinkolb/cloud/ui";

export default function AdminAiSkills(props: { title: string; subtitle: string; icon: string }) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <PanelDialog surface="floating">
        <PanelDialog.Header title={props.title} subtitle={props.subtitle} icon={props.icon} />
        <PanelDialog.Body>
          <AiSkillsManagerBody isAdmin />
        </PanelDialog.Body>
      </PanelDialog>
    </div>
  );
}
