import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/cloud";

export default function CloudCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
