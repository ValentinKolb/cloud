import { CatalogSectionDemo } from "./CatalogSectionDemo";
import demos from "./demo-sections/feedback";

export default function FeedbackCatalogDemo(props: { slug: string }) {
  return <CatalogSectionDemo demos={demos} slug={props.slug} />;
}
