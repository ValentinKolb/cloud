import SpaceEditPanel from "./SpaceEditPanel";
import type { SpaceEditPanelProps } from "./types";

export default function SpaceSettingsRoute(props: SpaceEditPanelProps) {
  return <SpaceEditPanel {...props} onClose={() => window.location.assign(`/app/spaces/${props.space.id}`)} />;
}
