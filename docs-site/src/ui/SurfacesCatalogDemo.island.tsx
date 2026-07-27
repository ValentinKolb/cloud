import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/surfaces";

export default function SurfacesCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
