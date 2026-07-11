import { Placeholder } from "@valentinkolb/cloud/ui";

type Props = {
  title: string;
  description: string;
  icon: string;
};

/** Shared recovery state for unavailable contact-book routes. */
export default function ContactBookUnavailable(props: Props) {
  return (
    <main class="cloud-ui-soft mx-auto flex min-h-64 max-w-md items-center px-3">
      <Placeholder
        state="error"
        variant="panel"
        surface="paper"
        title={props.title}
        description={props.description}
        icon={props.icon}
        class="w-full"
        action={
          <a href="/app/contacts" class="btn-secondary btn-sm">
            Back to contacts
          </a>
        }
      />
    </main>
  );
}
