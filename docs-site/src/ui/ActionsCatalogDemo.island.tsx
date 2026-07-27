import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/actions";

export default function ActionsCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
