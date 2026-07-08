import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

const StartTab = () => (
  <DocPage>
    <DocLead>
      Files browses the home and group file bases your IPA account can access, then lets you upload, move, search, and manage items there.
    </DocLead>

    <DocSection title="Overview" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "File base",
            icon: "ti-database",
            text: "One storage root. Your home base belongs to your IPA user; group bases come from your group memberships.",
          },
          {
            title: "Folder path",
            icon: "ti-folders",
            text: "The current directory inside the selected base. Breadcrumbs and URLs keep the path shareable inside the app.",
          },
          {
            title: "Selection",
            icon: "ti-list-check",
            text: "Selected items enable bulk actions such as move, download, delete, and select all.",
          },
          {
            title: "Detail panel",
            icon: "ti-layout-sidebar-right",
            text: "Selecting a file opens metadata and actions without leaving the current folder or search results.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <DocRows
        items={[
          {
            title: "Choose a base",
            icon: "ti-home",
            text: "Open your home storage or a group storage from the sidebar. Files redirects to the first accessible base when possible.",
          },
          {
            title: "Browse or search",
            icon: "ti-search",
            text: "Use folder search for the current directory or the Search page for glob patterns across selected bases.",
          },
          {
            title: "Upload or create",
            icon: "ti-upload",
            text: "Use the plus menu to upload files, upload a folder, or create a new folder in the current path.",
          },
          {
            title: "Open details before changing",
            icon: "ti-file-info",
            text: "The detail panel shows path, kind, modified time, size, preview actions, and file operations.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Access comes from IPA" variant="info">
      Files is available to full IPA users. Home access is tied to your user UID, and group storage is tied to recursive IPA group membership.
    </DocNote>
  </DocPage>
);

const WorkTab = () => (
  <DocPage>
    <DocLead>
      Most file work happens from the toolbar, the item context menu, or the detail panel.
    </DocLead>

    <DocSection title="Manage items">
      <DocRows
        items={[
          {
            title: "Open and preview",
            icon: "ti-eye",
            text: "Folders open in the app. Images open in the lightbox; browser-previewable files can open inline or in a new tab.",
          },
          {
            title: "Download",
            icon: "ti-download",
            text: "Files download directly. Folders download as a tar archive.",
          },
          {
            title: "Rename, duplicate, or move",
            icon: "ti-folder-share",
            text: "Rename and duplicate stay in the current base. Move can target another accessible base from the move dialog.",
          },
          {
            title: "Delete",
            icon: "ti-trash",
            text: "Delete moves items to Trash. The app prevents deleting from Trash.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Search and display">
      <DocRows
        items={[
          {
            title: "Folder search",
            icon: "ti-filter",
            text: "The folder search filters the current directory by name and keeps the filter in the URL.",
          },
          {
            title: "Global search",
            icon: "ti-file-search",
            text: "The Search page uses glob patterns such as **/*.pdf and can include hidden files or folders.",
          },
          {
            title: "Panel settings",
            icon: "ti-adjustments",
            text: "Switch between list and grid, choose list columns, show hidden files, and enable precise file sizes.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Precise sizes can be slower" variant="tip">
      Precise file sizes are computed server-side for the selected directory. Enable them when you need totals, and turn them off for faster
      browsing.
    </DocNote>
  </DocPage>
);

export default function FilesLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="files-start"
        title="Start"
        icon="ti ti-folders"
        description="File bases, folder paths, browsing, upload, and the detail workflow."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="files-work"
        title="Workflows"
        icon="ti ti-file-search"
        description="Search, previews, item actions, Trash behavior, and display settings."
        order={110}
      >
        <WorkTab />
      </Layout.Help>
    </>
  );
}
