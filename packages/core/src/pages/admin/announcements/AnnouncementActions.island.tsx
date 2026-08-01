import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, IconButton, prompts, Tooltip, toast } from "@k2b/ui";
import { coreClient } from "@valentinkolb/cloud/clients/core";
import type { AnnouncementEntry, CreateAnnouncement, UpdateAnnouncement } from "@valentinkolb/cloud/contracts";

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
};

const toIso = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? trimmed : date.toISOString();
};

type FormResult = {
  kind: "announcement" | "banner";
  title: string;
  body: string;
  tone: "info" | "success" | "warning" | "danger";
  publishedAt?: string;
  expiresAt?: string;
};

const openAnnouncementForm = (entry?: AnnouncementEntry) =>
  prompts.form({
    title: entry ? "Edit Announcement" : "New Announcement",
    icon: entry ? "ti ti-pencil" : "ti ti-plus",
    confirmText: entry ? "Save" : "Create",
    size: "large",
    fields: {
      kind: {
        type: "select" as const,
        label: "Type",
        description: "Choose whether this is a release-style announcement or a dismissible banner.",
        options: [
          { id: "announcement", label: "Announcement", description: "Release notes or larger updates.", icon: "ti ti-speakerphone" },
          { id: "banner", label: "Banner", description: "Short notice shown above app content until dismissed.", icon: "ti ti-message" },
        ],
        default: entry?.kind ?? "announcement",
        required: true,
      },
      title: {
        type: "text" as const,
        label: "Title",
        description: "Short heading shown above the message.",
        default: entry?.title,
        required: true,
        maxLength: 180,
      },
      body: {
        type: "text" as const,
        label: "Body",
        description: "Markdown content rendered for users.",
        default: entry?.body,
        markdown: true,
        lines: 10,
        required: true,
        maxLength: 20_000,
      },
      tone: {
        type: "select" as const,
        label: "Tone",
        description: "Controls the icon and color treatment.",
        options: [
          { id: "info", label: "Info", icon: "ti ti-info-circle" },
          { id: "success", label: "Success", icon: "ti ti-circle-check" },
          { id: "warning", label: "Warning", icon: "ti ti-alert-triangle" },
          { id: "danger", label: "Danger", icon: "ti ti-alert-circle" },
        ],
        default: entry?.tone ?? "info",
        required: true,
      },
      publishedAt: {
        type: "text" as const,
        label: "Publish date",
        description: "ISO date/time. Leave empty to publish now.",
        placeholder: new Date().toISOString(),
        default: entry?.publishedAt,
      },
      expiresAt: {
        type: "text" as const,
        label: "Expiry date",
        description: "Optional ISO date/time. Empty means no expiry.",
        placeholder: "No expiry",
        default: entry?.expiresAt ?? "",
      },
    },
  }) as Promise<FormResult | null>;

const toCreatePayload = (result: FormResult): CreateAnnouncement => ({
  kind: result.kind,
  title: result.title.trim(),
  body: result.body.trim(),
  tone: result.tone,
  publishedAt: toIso(result.publishedAt),
  expiresAt: toIso(result.expiresAt),
});

const toUpdatePayload = (result: FormResult): UpdateAnnouncement => ({
  kind: result.kind,
  title: result.title.trim(),
  body: result.body.trim(),
  tone: result.tone,
  publishedAt: toIso(result.publishedAt),
  expiresAt: toIso(result.expiresAt) ?? null,
});

function CreateAnnouncementButton() {
  const create = mutations.create<AnnouncementEntry, CreateAnnouncement>({
    mutation: async (data) => {
      const response = await coreClient.admin.core.announcements.$post({ json: data });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to create announcement"));
      return response.json();
    },
    onSuccess: () => {
      toast.success("Announcement created.");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error instanceof Error ? error.message : "Failed to create announcement."),
  });

  const handleClick = async () => {
    const result = await openAnnouncementForm();
    if (!result) return;
    create.mutate(toCreatePayload(result));
  };

  return (
    <Button type="button" size="sm" onClick={handleClick} loading={create.loading()} loadingLabel="Creating">
      <i class="ti ti-plus" aria-hidden="true" />
      New
    </Button>
  );
}

function AnnouncementRowActions(props: { entry: AnnouncementEntry }) {
  const update = mutations.create<AnnouncementEntry, UpdateAnnouncement>({
    mutation: async (data) => {
      const response = await coreClient.admin.core.announcements[":id"].$patch({
        param: { id: props.entry.id },
        json: data,
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to update announcement"));
      return response.json();
    },
    onSuccess: () => {
      toast.success("Announcement updated.");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error instanceof Error ? error.message : "Failed to update announcement."),
  });

  const remove = mutations.create<void, void>({
    mutation: async () => {
      const response = await coreClient.admin.core.announcements[":id"].$delete({ param: { id: props.entry.id } });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to delete announcement"));
    },
    onSuccess: () => {
      toast.success("Announcement deleted.");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error instanceof Error ? error.message : "Failed to delete announcement."),
  });

  const handleEdit = async () => {
    const result = await openAnnouncementForm(props.entry);
    if (!result) return;
    update.mutate(toUpdatePayload(result));
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Delete "${props.entry.title}"?`, {
      title: "Delete announcement",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (confirmed) remove.mutate();
  };

  return (
    <div class="flex justify-end gap-1">
      <Tooltip content="Edit announcement">
        <IconButton label="Edit announcement" size="sm" onClick={handleEdit} loading={update.loading()} loadingLabel="Editing announcement">
          <i class="ti ti-pencil" aria-hidden="true" />
        </IconButton>
      </Tooltip>
      <Tooltip content="Delete announcement">
        <IconButton
          label="Delete announcement"
          variant="danger"
          size="sm"
          onClick={handleDelete}
          loading={remove.loading()}
          loadingLabel="Deleting announcement"
        >
          <i class="ti ti-trash" aria-hidden="true" />
        </IconButton>
      </Tooltip>
    </div>
  );
}

type AnnouncementActionsProps = { mode: "create" } | { mode: "row"; entry: AnnouncementEntry };

export default function AnnouncementActions(props: AnnouncementActionsProps) {
  if (props.mode === "create") return <CreateAnnouncementButton />;
  return <AnnouncementRowActions entry={props.entry} />;
}
