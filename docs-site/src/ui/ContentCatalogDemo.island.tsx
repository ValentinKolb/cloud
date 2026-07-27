import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/content";

export default function ContentCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
