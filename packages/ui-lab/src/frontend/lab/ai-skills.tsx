import { AiSkillsManagerBody, openAiSkillsManager } from "@valentinkolb/cloud/ui";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

export const AiSkillsManagerDemo = () => (
  <DemoCard
    id="ai-skills-manager"
    chip={[
      { kind: "component", name: "AiSkillsManagerBody", from: FROM_UI },
      { kind: "component", name: "AiSkillsManagerDialog", from: FROM_UI },
      { kind: "component", name: "AiSkillDetailDialog", from: FROM_UI },
    ]}
    description="The embedded body shows the signed-in user's catalog. The dialog launcher reuses it; selecting a skill opens AiSkillDetailDialog, so list, modal, and detail hierarchy stay one implementation."
    code={`<AiSkillsManagerBody isAdmin={false} />

await openAiSkillsManager();`}
  >
    <div class="flex flex-col gap-3">
      <div class="rounded-lg bg-[var(--ui-surface-subtle)] p-3">
        <AiSkillsManagerBody isAdmin={false} />
      </div>
      <div>
        <button type="button" class="btn-primary btn-sm" onClick={() => void openAiSkillsManager()}>
          <i class="ti ti-wand" aria-hidden="true" />
          Open skills manager
        </button>
      </div>
    </div>
  </DemoCard>
);
