import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/widgets";

export default function WidgetsCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
