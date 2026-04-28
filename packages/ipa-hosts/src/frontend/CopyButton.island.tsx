import { CopyButton as BaseCopyButton } from "@valentinkolb/cloud/ui";

type Props = {
  text: string;
  label?: string;
  class?: string;
};

/**
 * Island wrapper so CopyButton stays interactive when rendered from SSR-only host rows.
 */
const CopyButton = (props: Props) => {
  return <BaseCopyButton text={props.text} label={props.label} class={props.class} />;
};

export default CopyButton;
