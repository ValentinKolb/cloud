import { Placeholder } from "@valentinkolb/cloud/ui";

type Props = {
  title: string;
  description: string;
  icon: string;
  actionHref?: string;
  actionLabel?: string;
};

/** Shared recovery state for unavailable file-storage routes. */
export default function FilesUnavailable(props: Props) {
  return (
    <main class="mx-auto flex min-h-64 max-w-md items-center px-3">
      <Placeholder
        state="error"
        variant="panel"
        surface="paper"
        title={props.title}
        description={props.description}
        icon={props.icon}
        class="w-full"
        action={
          <a href={props.actionHref ?? "/app/files"} class="btn-secondary btn-sm">
            {props.actionLabel ?? "Back to files"}
          </a>
        }
      />
    </main>
  );
}
