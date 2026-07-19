---
id: notebooks-settings-access
title: "Settings & access"
icon: "ti ti-settings"
description: "Configure notebook details, permissions, exports, feature flags, and destructive actions."
order: 170
---

Notebook settings control the workspace around the notes: name, navigation mode, scripting, exports, access, and dangerous actions.

**Admin and workspace settings**

## Settings tabs {icon="settings"}

:::reference
- **General:** Name, icon, description, default start page, and the Liquid template used to initialize the H1 of empty new notes.
- **View & features:** Sidebar mode and notebook-level behavior such as script blocks.
- **Export:** Download a portable notebook archive and configure snapshot export when available.
- **Access:** Admin-only permission editor. Permission changes save immediately.
- **Danger zone:** Admin-only destructive actions such as deleting the notebook and its notes.
:::

**Safety**

## Script feature flag {icon="shield-lock"}

:::warning Enable scripts only for trusted notebooks
Scripts run in each viewer's browser and can perform notebook actions with that viewer's permissions. Keep scripting disabled when editors or note content are not trusted.
:::
