import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/layout";

export default function LayoutCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
