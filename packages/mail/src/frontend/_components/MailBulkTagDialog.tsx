import { MultiSelectInput, Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { createSignal, Show } from "solid-js";
import type { LocalTag } from "../../service/local-tags";

export const chooseBulkTags = (tags: LocalTag[]): Promise<string[] | null | undefined> =>
  prompts.dialog<string[] | null>(
    (close) => {
      const [selectedTagIds, setSelectedTagIds] = createSignal<string[]>([]);
      return (
        <div class="flex flex-col gap-4">
          <Show
            when={tags.length > 0}
            fallback={
              <Placeholder
                icon="ti ti-tags-off"
                title="No tags available"
                description="Create a tag from a conversation's details before assigning it in bulk."
              />
            }
          >
            <p class="text-sm text-secondary">Choose one or more tags. Existing tags on the selected conversations stay in place.</p>
            <MultiSelectInput
              label="Tags"
              icon="ti ti-tags"
              placeholder="Choose tags"
              value={selectedTagIds}
              onChange={setSelectedTagIds}
              options={tags.map((tag) => ({ id: tag.id, label: tag.name, icon: "ti ti-tag", color: tag.color }))}
            />
          </Show>
          <div class="flex items-center justify-end gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button
              type="button"
              class="btn-primary btn-sm"
              disabled={selectedTagIds().length === 0}
              onClick={() => close(selectedTagIds())}
            >
              <i class="ti ti-tags" aria-hidden="true" /> Add tags
            </button>
          </div>
        </div>
      );
    },
    { title: "Add tags", icon: "ti ti-tags", size: "medium" },
  );

export const chooseConversationTags = (tags: LocalTag[], selectedTags: LocalTag[]): Promise<string[] | null | undefined> =>
  prompts.dialog<string[] | null>(
    (close) => {
      const [selectedTagIds, setSelectedTagIds] = createSignal(selectedTags.map((tag) => tag.id));
      return (
        <div class="flex flex-col gap-4">
          <Show
            when={tags.length > 0}
            fallback={<Placeholder icon="ti ti-tags-off" title="No tags available" description="Create a tag in mailbox settings first." />}
          >
            <MultiSelectInput
              label="Tags"
              icon="ti ti-tags"
              placeholder="Choose tags"
              value={selectedTagIds}
              onChange={setSelectedTagIds}
              options={tags.map((tag) => ({ id: tag.id, label: tag.name, icon: "ti ti-tag", color: tag.color }))}
              selectedOptions={() => selectedTags.map((tag) => ({ id: tag.id, label: tag.name, icon: "ti ti-tag", color: tag.color }))}
              clearable
            />
          </Show>
          <div class="flex items-center justify-end gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" disabled={tags.length === 0} onClick={() => close(selectedTagIds())}>
              <i class="ti ti-check" aria-hidden="true" /> Save tags
            </button>
          </div>
        </div>
      );
    },
    { title: "Conversation tags", icon: "ti ti-tags", size: "medium" },
  );
