import { createMockCover } from "@valentinkolb/cloud/shared";
import { currentMonthDate, field, form, formula, type GridTemplate, launcher, record, table, view, viewColumns } from "./types";

export const inventoryTemplate: GridTemplate = {
  id: "inventory",
  name: "Inventory",
  description: "Track assets, storage locations, equipment loans, agreements, and repairs.",
  highlights: [
    "Assets, kits, locations, and loan requests",
    "Availability and loan workload overview",
    "Guided agreement delivery, returns, and asset-label defect reporting",
  ],
  icon: "ti ti-packages",
  baseName: "Inventory",
  baseDescription: "Manage inventory, locations, kits, and loan requests.",
  tables: [
    {
      key: "categories",
      name: "Categories",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "Category name shown on items and kits.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-tag",
        },
        {
          key: "description",
          name: "Description",
          description: "Optional notes that explain what belongs in this category.",
          type: "longtext",
          config: { markdown: true },
          icon: "ti ti-align-left",
        },
      ],
    },
    {
      key: "locations",
      name: "Locations",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "Location name shown in item records.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-map-pin",
        },
        {
          key: "room",
          name: "Room",
          description: "Room or area where this location sits.",
          type: "text",
          icon: "ti ti-door",
        },
        {
          key: "shelf",
          name: "Shelf",
          description: "Shelf, cabinet, or bin identifier.",
          type: "text",
          icon: "ti ti-stack",
        },
        {
          key: "notes",
          name: "Notes",
          description: "Internal notes about this storage location.",
          type: "longtext",
          config: { markdown: true },
          icon: "ti ti-notes",
        },
      ],
    },
    {
      key: "items",
      name: "Items",
      displayConfig: {
        mode: "cards",
        cards: {
          imageFieldId: field("items.files"),
          fieldIds: [
            field("items.asset_id"),
            field("items.asset_barcode"),
            field("items.name"),
            field("items.category"),
            field("items.location"),
            field("items.status"),
            field("items.condition"),
            field("items.quantity"),
          ],
        },
      },
      fields: [
        {
          key: "asset_id",
          name: "Asset ID",
          description: "Server-generated inventory number for this item.",
          type: "id",
          config: { strategy: "sequence", prefix: "ITEM-", padding: 4 },
          presentable: true,
          icon: "ti ti-id",
        },
        {
          key: "asset_barcode",
          name: "Asset barcode",
          description: "Scannable barcode for the asset ID.",
          type: "formula",
          config: {
            expression: formula(field("items.asset_id")),
            format: { kind: "barcode", bcid: "code128", showText: true },
          },
          icon: "ti ti-barcode",
        },
        {
          key: "name",
          name: "Name",
          description: "Item name shown in inventory lists and cards.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-package",
        },
        {
          key: "category",
          name: "Category",
          description: "Category this item belongs to.",
          type: "relation",
          icon: "ti ti-tag",
          config: { targetTableId: table("categories"), cardinality: "single" },
        },
        {
          key: "location",
          name: "Location",
          description: "Current storage location for this item.",
          type: "relation",
          icon: "ti ti-map-pin",
          config: { targetTableId: table("locations"), cardinality: "single" },
        },
        {
          key: "status",
          name: "Status",
          description: "Availability state used for filtering and loan planning.",
          type: "select",
          icon: "ti ti-traffic-lights",
          config: {
            options: [
              { id: "available", label: "Available", color: "#22c55e" },
              { id: "reserved", label: "Reserved", color: "#3b82f6" },
              { id: "in_use", label: "In use", color: "#f59e0b" },
              { id: "maintenance", label: "Maintenance", color: "#ef4444" },
            ],
          },
          required: true,
          defaultValue: ["available"],
        },
        {
          key: "condition",
          name: "Condition",
          description: "Physical condition of this item.",
          type: "select",
          icon: "ti ti-stars",
          config: {
            options: [
              { id: "new", label: "New", color: "#22c55e" },
              { id: "good", label: "Good", color: "#3b82f6" },
              { id: "used", label: "Used", color: "#f59e0b" },
              { id: "repair", label: "Needs repair", color: "#ef4444" },
            ],
          },
        },
        {
          key: "serial_no",
          name: "Serial number",
          description: "Manufacturer serial number or other external identifier.",
          type: "text",
          icon: "ti ti-barcode",
        },
        {
          key: "tags",
          name: "Tags",
          description: "Reusable tags for item handling and search.",
          type: "select",
          icon: "ti ti-tags",
          config: {
            multiple: true,
            options: [
              { id: "portable", label: "Portable", color: "#3b82f6" },
              { id: "fragile", label: "Fragile", color: "#f59e0b" },
              { id: "calibrated", label: "Calibrated", color: "#22c55e" },
              { id: "shared", label: "Shared", color: "#8b5cf6" },
            ],
          },
        },
        {
          key: "quantity",
          name: "Quantity",
          description: "Number of units represented by this record.",
          type: "number",
          required: true,
          defaultValue: "1",
          config: { min: "0", decimalPlaces: 0 },
          icon: "ti ti-hash",
        },
        {
          key: "replacement_value",
          name: "Replacement value",
          description: "Estimated cost to replace one unit.",
          type: "number",
          icon: "ti ti-currency-euro",
          config: {
            precision: 16,
            decimalPlaces: 2,
            unit: "EUR",
            unitPosition: "suffix",
          },
        },
        {
          key: "total_value",
          name: "Total value",
          description: "Quantity multiplied by replacement value.",
          type: "formula",
          config: {
            expression: formula(field("items.quantity"), " * ", field("items.replacement_value")),
            format: {
              kind: "decimal",
              precision: 2,
              thousandsSeparator: true,
            },
          },
          icon: "ti ti-calculator",
        },
        {
          key: "purchase_date",
          name: "Purchase date",
          description: "Date this item was purchased or added.",
          type: "date",
          icon: "ti ti-calendar",
        },
        {
          key: "files",
          name: "Files",
          description: "Photos, manuals, receipts, or other attachments.",
          type: "file",
          icon: "ti ti-paperclip",
          config: { maxFiles: 5 },
        },
        {
          key: "notes",
          name: "Notes",
          description: "Internal notes about this item.",
          type: "longtext",
          config: { markdown: true },
          icon: "ti ti-notes",
        },
      ],
    },
    {
      key: "kits",
      name: "Kits",
      fields: [
        {
          key: "kit_code",
          name: "Kit code",
          description: "Short generated code for this kit.",
          type: "id",
          config: { strategy: "short_code", prefix: "KIT-", length: 6 },
          presentable: true,
          icon: "ti ti-id",
        },
        {
          key: "name",
          name: "Name",
          description: "Kit name shown to staff and requesters.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-tag",
        },
        {
          key: "category",
          name: "Category",
          description: "Category this kit belongs to.",
          type: "relation",
          icon: "ti ti-tag",
          config: { targetTableId: table("categories"), cardinality: "single" },
        },
        {
          key: "items",
          name: "Items",
          description: "Inventory items included in this kit.",
          type: "relation",
          icon: "ti ti-package",
          config: { targetTableId: table("items"), cardinality: "multiple" },
        },
        {
          key: "status",
          name: "Status",
          description: "Operational state of this kit.",
          type: "select",
          icon: "ti ti-circle-check",
          config: {
            options: [
              { id: "available", label: "Available", color: "#22c55e" },
              { id: "reserved", label: "Reserved", color: "#3b82f6" },
              { id: "incomplete", label: "Incomplete", color: "#f59e0b" },
              { id: "internal", label: "Internal only", color: "#3b82f6" },
              { id: "retired", label: "Retired", color: "#94a3b8" },
            ],
          },
          required: true,
          defaultValue: ["available"],
        },
        {
          key: "requestable",
          name: "Requestable",
          description: "Whether this kit can be requested through forms.",
          type: "boolean",
          defaultValue: true,
          icon: "ti ti-world-check",
        },
        {
          key: "description",
          name: "Description",
          description: "Public-facing explanation of what the kit contains.",
          type: "longtext",
          config: { markdown: true },
          icon: "ti ti-align-left",
        },
        {
          key: "notes",
          name: "Admin notes",
          description: "Internal staff notes about this kit.",
          type: "longtext",
          config: { markdown: true },
          icon: "ti ti-notes",
        },
      ],
    },
    {
      key: "loans",
      name: "Loans",
      fields: [
        {
          key: "loan_no",
          name: "Loan number",
          description: "Generated loan request number.",
          type: "id",
          config: {
            strategy: "date_sequence",
            prefix: "LOAN-",
            period: "year",
            padding: 4,
          },
          presentable: true,
          icon: "ti ti-id",
        },
        {
          key: "requester_name",
          name: "Requester name",
          description: "Person requesting or borrowing the kit.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-user",
        },
        {
          key: "requester_email",
          name: "Requester email",
          description: "Email address for loan communication.",
          type: "text",
          config: { regex: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
          required: true,
          icon: "ti ti-mail",
        },
        {
          key: "organization",
          name: "Organization",
          description: "Optional team, department, or external organization.",
          type: "text",
          icon: "ti ti-building",
        },
        {
          key: "kits",
          name: "Kits",
          description: "Kits requested or borrowed in this loan.",
          type: "relation",
          required: true,
          icon: "ti ti-box",
          config: { targetTableId: table("kits"), cardinality: "multiple" },
        },
        {
          key: "items",
          name: "Loaned items",
          description: "Specific inventory records handed out under this loan.",
          type: "relation",
          icon: "ti ti-package",
          config: { targetTableId: table("items"), cardinality: "multiple" },
        },
        {
          key: "start_date",
          name: "Requested from",
          description: "Requested start date for the loan.",
          type: "date",
          required: true,
          icon: "ti ti-calendar-plus",
        },
        {
          key: "due_date",
          name: "Due date",
          description: "Expected return date for borrowed kits.",
          type: "date",
          required: true,
          icon: "ti ti-calendar-due",
        },
        {
          key: "schedule_valid",
          name: "Schedule valid",
          description: "Whether the return date is on or after the requested start date.",
          type: "formula",
          config: {
            expression: formula(field("loans.start_date"), " <= ", field("loans.due_date")),
          },
          icon: "ti ti-calendar-check",
        },
        {
          key: "returned_at",
          name: "Returned at",
          description: "Actual date when the kits were returned.",
          type: "date",
          icon: "ti ti-calendar-check",
        },
        {
          key: "status",
          name: "Status",
          description: "Current approval and return status.",
          type: "select",
          icon: "ti ti-progress",
          config: {
            options: [
              { id: "requested", label: "Requested", color: "#3b82f6" },
              { id: "approved", label: "Approved", color: "#22c55e" },
              { id: "active", label: "Active", color: "#f59e0b" },
              { id: "returned", label: "Returned", color: "#94a3b8" },
              { id: "rejected", label: "Rejected", color: "#ef4444" },
              { id: "cancelled", label: "Cancelled", color: "#94a3b8" },
            ],
          },
          required: true,
          defaultValue: ["requested"],
        },
        {
          key: "availability_confirmed",
          name: "Availability confirmed",
          description: "An admin has checked the selected kits, their items, and the requested dates before approval.",
          type: "boolean",
          defaultValue: false,
          icon: "ti ti-calendar-check",
        },
        {
          key: "agreement_sent",
          name: "Agreement sent",
          description: "Set once the agreement workflow has succeeded, so it is not replayed.",
          type: "boolean",
          defaultValue: false,
          icon: "ti ti-mail-check",
        },
        {
          key: "purpose",
          name: "Purpose",
          description: "Requester-provided reason for the loan.",
          type: "longtext",
          icon: "ti ti-message",
        },
        {
          key: "notes",
          name: "Admin notes",
          description: "Internal staff notes about this loan.",
          type: "longtext",
          config: { markdown: true },
          icon: "ti ti-notes",
        },
      ],
    },
  ],
  records: [
    {
      key: "categories.cameras",
      table: "categories",
      values: { name: "Cameras" },
    },
    { key: "categories.audio", table: "categories", values: { name: "Audio" } },
    {
      key: "categories.cables",
      table: "categories",
      values: { name: "Cables" },
    },
    {
      key: "locations.studio",
      table: "locations",
      values: { name: "Studio shelf", room: "Studio", shelf: "A2" },
    },
    {
      key: "locations.storage",
      table: "locations",
      values: { name: "Storage cabinet", room: "Storage", shelf: "C1" },
    },
    {
      key: "items.camera",
      table: "items",
      values: {
        name: "Sony A7 body",
        category: [record("categories.cameras")],
        location: [record("locations.studio")],
        status: ["in_use"],
        condition: ["good"],
        serial_no: "A7-001",
        tags: ["fragile", "portable"],
        quantity: "1",
        replacement_value: "1800.00",
        purchase_date: "2025-09-12",
      },
      files: [
        {
          field: "files",
          filename: "sony-a7-body.svg",
          dataUrl: createMockCover({
            icon: "camera",
            theme: "blue",
            seed: "inventory:sony-a7-body",
            label: "Sony A7 body",
          }).dataUrl,
        },
      ],
    },
    {
      key: "items.mic",
      table: "items",
      values: {
        name: "Wireless mic set",
        category: [record("categories.audio")],
        location: [record("locations.studio")],
        status: ["available"],
        condition: ["good"],
        tags: ["portable", "shared"],
        quantity: "2",
        replacement_value: "320.00",
      },
      files: [
        {
          field: "files",
          filename: "wireless-mic-set.svg",
          dataUrl: createMockCover({
            icon: "microphone",
            theme: "violet",
            seed: "inventory:wireless-mic-set",
            label: "Wireless mic set",
          }).dataUrl,
        },
      ],
    },
    {
      key: "items.hdmi",
      table: "items",
      values: {
        name: "HDMI cable 5m",
        category: [record("categories.cables")],
        location: [record("locations.storage")],
        status: ["available"],
        condition: ["used"],
        tags: ["shared"],
        quantity: "8",
        replacement_value: "18.00",
      },
      files: [
        {
          field: "files",
          filename: "hdmi-cable-5m.svg",
          dataUrl: createMockCover({
            icon: "package",
            theme: "slate",
            seed: "inventory:hdmi-cable-5m",
            label: "HDMI cable 5m",
          }).dataUrl,
        },
      ],
    },
    {
      key: "kits.video",
      table: "kits",
      values: {
        name: "Video interview kit",
        category: [record("categories.cameras")],
        items: [record("items.camera"), record("items.mic"), record("items.hdmi")],
        status: ["available"],
        requestable: true,
        description: "Camera body, wireless mic set, and HDMI cable for interviews.",
      },
    },
    {
      key: "loans.demo",
      table: "loans",
      values: {
        requester_name: "Mara Example",
        requester_email: "mara@example.test",
        organization: "Design team",
        kits: [record("kits.video")],
        items: [record("items.camera")],
        start_date: currentMonthDate(10),
        due_date: currentMonthDate(12),
        status: ["active"],
        availability_confirmed: true,
        agreement_sent: false,
        purpose: "Record a short product interview.",
      },
    },
    {
      key: "loans.demo_2",
      table: "loans",
      values: {
        requester_name: "Jonas Example",
        requester_email: "jonas@example.test",
        organization: "Training team",
        kits: [record("kits.video")],
        start_date: currentMonthDate(18),
        due_date: currentMonthDate(20),
        status: ["rejected"],
        availability_confirmed: false,
        agreement_sent: false,
        purpose: "Prepare a team training recording.",
      },
    },
  ],
  views: [
    {
      key: "available_items",
      table: "items",
      name: "Available items",
      shared: true,
      source: formula(
        "from table ",
        table("items"),
        "\nselect ",
        field("items.asset_barcode"),
        ", ",
        field("items.name"),
        ", ",
        field("items.category"),
        ", ",
        field("items.location"),
        ", ",
        field("items.quantity"),
        ", ",
        field("items.total_value"),
        "\nwhere ",
        field("items.status"),
        " = 'available'",
      ),
      ui: {
        columns: [
          {
            fieldId: field("items.asset_barcode"),
            label: "Asset ID",
            format: { kind: "barcode", bcid: "code128", showText: true },
          },
          { fieldId: field("items.name") },
          { fieldId: field("items.category") },
          { fieldId: field("items.location") },
          { fieldId: field("items.quantity") },
          { fieldId: field("items.total_value") },
        ],
        displayConfig: {
          mode: "cards",
          cards: {
            imageFieldId: field("items.files"),
            fieldIds: [
              field("items.asset_id"),
              field("items.asset_barcode"),
              field("items.name"),
              field("items.category"),
              field("items.location"),
              field("items.status"),
              field("items.quantity"),
            ],
          },
        },
      },
    },
    {
      key: "open_loans",
      table: "loans",
      name: "Open loans",
      shared: true,
      source: formula(
        "from table ",
        table("loans"),
        "\nselect ",
        field("loans.loan_no"),
        ", ",
        field("loans.requester_name"),
        ", ",
        field("loans.organization"),
        ", ",
        field("loans.kits"),
        ", ",
        field("loans.start_date"),
        ", ",
        field("loans.due_date"),
        ", ",
        field("loans.schedule_valid"),
        ", ",
        field("loans.status"),
        "\nwhere oneof(",
        field("loans.status"),
        ", 'requested', 'approved', 'active')\nsort ",
        field("loans.due_date"),
        " asc",
      ),
      ui: {
        columns: [
          { fieldId: field("loans.loan_no") },
          { fieldId: field("loans.requester_name") },
          { fieldId: field("loans.organization") },
          { fieldId: field("loans.kits") },
          { fieldId: field("loans.start_date") },
          { fieldId: field("loans.due_date") },
          { fieldId: field("loans.schedule_valid") },
          { fieldId: field("loans.status") },
        ],
        displayConfig: {
          mode: "calendar",
          calendar: { dateFieldId: field("loans.due_date") },
        },
      },
    },
  ],
  forms: [
    {
      key: "add_item",
      table: "items",
      name: "Add item",
      config: {
        title: "Add item",
        submitLabel: "Add item",
        successMessage: "Item added.",
        fields: [
          {
            kind: "user_input",
            fieldId: field("items.name"),
            label: "Item name",
            helpText: "Name shown in inventory lists.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("items.category"),
            label: "Category",
            helpText: "Pick an existing category or create one inline.",
            inlineCreate: {
              enabled: true,
              fields: [
                {
                  fieldId: field("categories.name"),
                  label: "Category name",
                  helpText: "Short category name, for example Cameras.",
                  required: true,
                },
              ],
            },
          },
          {
            kind: "user_input",
            fieldId: field("items.location"),
            label: "Location",
            helpText: "Where this item is stored.",
            inlineCreate: {
              enabled: true,
              fields: [
                {
                  fieldId: field("locations.name"),
                  label: "Location name",
                  helpText: "Readable location label.",
                  required: true,
                },
                {
                  fieldId: field("locations.room"),
                  label: "Room",
                  helpText: "Room or area.",
                },
                {
                  fieldId: field("locations.shelf"),
                  label: "Shelf",
                  helpText: "Shelf, box, or cabinet.",
                },
              ],
            },
          },
          {
            kind: "user_input",
            fieldId: field("items.status"),
            label: "Status",
            helpText: "Current availability.",
            defaultValue: ["available"],
          },
          {
            kind: "user_input",
            fieldId: field("items.condition"),
            label: "Condition",
            helpText: "Physical state of the item.",
          },
          {
            kind: "user_input",
            fieldId: field("items.tags"),
            label: "Tags",
            helpText: "Optional handling or usage labels.",
          },
          {
            kind: "user_input",
            fieldId: field("items.quantity"),
            label: "Quantity",
            helpText: "How many units are available.",
            required: true,
            defaultValue: "1",
          },
          {
            kind: "user_input",
            fieldId: field("items.replacement_value"),
            label: "Replacement value",
            helpText: "Cost to replace one unit.",
          },
          {
            kind: "user_input",
            fieldId: field("items.notes"),
            label: "Notes",
            helpText: "Extra context for admins.",
          },
        ],
      },
    },
    {
      key: "request_loan",
      table: "loans",
      name: "Request loan",
      isPublic: true,
      config: {
        title: "Request kit loan",
        description: "Choose one or more kits. An admin reviews and approves the request.",
        submitLabel: "Request loan",
        successMessage: "Loan requested.",
        fields: [
          {
            kind: "user_input",
            fieldId: field("loans.requester_name"),
            label: "Name",
            helpText: "Who should receive the kit.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("loans.requester_email"),
            label: "Email",
            helpText: "Contact address for questions and approval.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("loans.organization"),
            label: "Organization",
            helpText: "Team, company, or project.",
          },
          {
            kind: "user_input",
            fieldId: field("loans.kits"),
            label: "Kits",
            helpText: "Choose one or more kits to borrow.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("loans.start_date"),
            label: "Start date",
            helpText: "First planned day of use.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("loans.due_date"),
            label: "Due date",
            helpText: "Planned return date.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("loans.purpose"),
            label: "Purpose",
            helpText: "What the kit will be used for.",
          },
          {
            kind: "form_value",
            fieldId: field("loans.status"),
            value: ["requested"],
          },
          {
            kind: "form_value",
            fieldId: field("loans.availability_confirmed"),
            value: false,
          },
          {
            kind: "form_value",
            fieldId: field("loans.agreement_sent"),
            value: false,
          },
        ],
      },
    },
  ],
  customApps: [
    {
      key: "equipment_loans",
      definition: {
        schemaVersion: 4,
        kind: "grids.custom-app",
        name: "Equipment Loans",
        icon: "package",
        sidebar: {
          actions: [
            {
              id: "new-loan",
              kind: "form",
              label: "New loan",
              icon: "plus",
              tone: "success",
              formId: form("request_loan"),
              fixedValues: {},
              onSuccessNavigate: {
                kind: "navigate",
                pageId: "loan",
                params: { loan_id: { source: "RESULT", path: "recordId" } },
              },
            },
          ],
        },
        startPageId: "home",
        pages: [
          {
            id: "home",
            title: "My equipment loans",
            navigation: { visible: true, icon: "home" },
            parameters: {},
            rows: [
              {
                id: "welcome",
                columns: [
                  {
                    id: "content",
                    span: 12,
                    blocks: [
                      {
                        id: "guidance",
                        type: "markdown",
                        markdown:
                          "# Equipment loans\n\nUse **New loan** to request a kit. Open a loan to follow its approval, agreement, handover, and return.",
                      },
                    ],
                  },
                ],
              },
              {
                id: "loans",
                columns: [
                  {
                    id: "content",
                    span: 12,
                    blocks: [
                      {
                        id: "my-loans",
                        type: "records",
                        title: "My loans",
                        emptyText: "You do not have any equipment loans yet.",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("loans"),
                            "\nwhere record.createdBy = @auth.id\nselect ",
                            field("loans.loan_no"),
                            ", ",
                            field("loans.purpose"),
                            ", ",
                            field("loans.start_date"),
                            ", ",
                            field("loans.due_date"),
                            ", ",
                            field("loans.status"),
                            "\nsort record.createdAt desc",
                          ),
                        },
                        display: { kind: "table", columnIds: [] },
                        searchable: true,
                        pageSize: 25,
                        rowNavigate: {
                          kind: "navigate",
                          pageId: "loan",
                          history: "push",
                          params: { loan_id: { source: "ROW", path: "id" } },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "catalog",
            title: "Equipment catalog",
            navigation: { visible: true, icon: "package" },
            parameters: {},
            rows: [
              {
                id: "catalog",
                columns: [
                  {
                    id: "content",
                    span: 12,
                    blocks: [
                      {
                        id: "available-items",
                        type: "records",
                        title: "Available equipment",
                        emptyText: "No equipment is currently available.",
                        source: { kind: "view", viewId: view("available_items") },
                        display: { kind: "cards" },
                        searchable: true,
                        pageSize: 25,
                        rowNavigate: {
                          kind: "navigate",
                          pageId: "item",
                          history: "push",
                          params: { item_id: { source: "ROW", path: "id" } },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "loan",
            title: "Loan details",
            navigation: { visible: false },
            parameters: { loan_id: { type: "record", tableId: table("loans"), required: true } },
            record: { tableId: table("loans"), id: { source: "PARAMS", path: "loan_id" } },
            availableWhen: {
              query: formula("from table ", table("loans"), "\nwhere record.id = @params.loan_id and record.createdBy = @auth.id\nlimit 1"),
            },
            rows: [
              {
                id: "detail",
                columns: [
                  {
                    id: "loan",
                    span: 8,
                    blocks: [
                      {
                        id: "loan",
                        type: "record",
                        title: "Loan overview",
                        fieldIds: [
                          field("loans.loan_no"),
                          field("loans.requester_name"),
                          field("loans.requester_email"),
                          field("loans.organization"),
                          field("loans.kits"),
                          field("loans.start_date"),
                          field("loans.due_date"),
                          field("loans.status"),
                          field("loans.purpose"),
                        ],
                        editableFieldIds: [],
                      },
                    ],
                  },
                  {
                    id: "updates",
                    span: 4,
                    blocks: [
                      {
                        id: "actions",
                        type: "actions",
                        actions: [
                          {
                            id: "cancel",
                            label: "Cancel request",
                            icon: "calendar-x",
                            kind: "workflow",
                            launcherId: launcher("cancel_loan_custom_app"),
                            inputs: { loan: { source: "RECORD", path: "id" } },
                            confirm: "Cancel this loan request?",
                            availableWhen: {
                              query: formula(
                                "from table ",
                                table("loans"),
                                "\nwhere record.id = @params.loan_id and ",
                                field("loans.status"),
                                " = 'requested'\nlimit 1",
                              ),
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                id: "updates",
                columns: [
                  {
                    id: "comments",
                    span: 12,
                    blocks: [
                      {
                        id: "comments",
                        type: "comments",
                        title: "Questions and updates",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "item",
            title: "Equipment details",
            navigation: { visible: false },
            parameters: { item_id: { type: "record", tableId: table("items"), required: true } },
            record: { tableId: table("items"), id: { source: "PARAMS", path: "item_id" } },
            rows: [
              {
                id: "item",
                columns: [
                  {
                    id: "content",
                    span: 12,
                    blocks: [
                      {
                        id: "item",
                        type: "record",
                        fieldIds: [
                          field("items.asset_id"),
                          field("items.name"),
                          field("items.category"),
                          field("items.location"),
                          field("items.status"),
                          field("items.condition"),
                          field("items.files"),
                          field("items.notes"),
                        ],
                        editableFieldIds: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      key: "loan_desk",
      definition: {
        schemaVersion: 4,
        kind: "grids.custom-app",
        name: "Loan Desk",
        icon: "clipboard-check",
        startPageId: "dashboard",
        pages: [
          {
            id: "dashboard",
            title: "Loan desk",
            navigation: { visible: true },
            parameters: {},
            rows: [
              {
                id: "metrics",
                columns: [
                  {
                    id: "open",
                    span: 4,
                    blocks: [
                      {
                        id: "open-loans",
                        type: "metrics",
                        title: "Open loans",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("loans"),
                            "\nwhere oneof(",
                            field("loans.status"),
                            ", 'requested', 'approved', 'active')\naggregate count(*) as open_loans",
                          ),
                        },
                      },
                    ],
                  },
                  {
                    id: "overdue",
                    span: 4,
                    blocks: [
                      {
                        id: "overdue-loans",
                        type: "metrics",
                        title: "Overdue loans",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("loans"),
                            "\nwhere ",
                            field("loans.due_date"),
                            " < @time.today and ",
                            field("loans.status"),
                            " = 'active'\naggregate count(*) as overdue_loans",
                          ),
                        },
                      },
                    ],
                  },
                  {
                    id: "stock",
                    span: 4,
                    blocks: [
                      {
                        id: "available-items",
                        type: "metrics",
                        title: "Available items",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("items"),
                            "\nwhere ",
                            field("items.status"),
                            " = 'available'\naggregate count(*) as available_items",
                          ),
                        },
                      },
                    ],
                  },
                ],
              },
              {
                id: "queue",
                columns: [
                  {
                    id: "content",
                    span: 12,
                    blocks: [
                      {
                        id: "loan-queue",
                        type: "records",
                        title: "Operational loan queue",
                        emptyText: "No open loans.",
                        source: { kind: "view", viewId: view("open_loans") },
                        display: { kind: "table", columnIds: viewColumns("open_loans") },
                        searchable: true,
                        pageSize: 25,
                        rowNavigate: {
                          kind: "navigate",
                          pageId: "loan",
                          history: "push",
                          params: { loan_id: { source: "ROW", path: "id" } },
                        },
                      },
                    ],
                  },
                ],
              },
              {
                id: "inventory-value",
                columns: [
                  {
                    id: "value",
                    span: 4,
                    blocks: [
                      {
                        id: "w-value",
                        type: "metrics",
                        title: "Inventory value",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("items"),
                            "\naggregate sum(formula(",
                            field("items.quantity"),
                            " * ",
                            field("items.replacement_value"),
                            ")) as inventory_value",
                          ),
                        },
                      },
                    ],
                  },
                  {
                    id: "status",
                    span: 8,
                    blocks: [
                      {
                        id: "loan-status",
                        type: "chart",
                        title: "Loans by status",
                        chartType: "donut",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("loans"),
                            "\ngroup by ",
                            field("loans.status"),
                            "\naggregate count(*) as loans\nsort loans desc",
                          ),
                        },
                        limit: 20,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "returns",
            title: "Returns",
            navigation: { visible: true, icon: "scan" },
            parameters: {},
            rows: [
              {
                id: "returns",
                columns: [
                  {
                    id: "damage",
                    span: 12,
                    blocks: [
                      {
                        id: "report-defect",
                        type: "scanner",
                        title: "Report damaged item",
                        launcherId: launcher("report_item_defect_scanner"),
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "loan",
            title: "Loan administration",
            navigation: { visible: false },
            parameters: { loan_id: { type: "record", tableId: table("loans"), required: true } },
            record: { tableId: table("loans"), id: { source: "PARAMS", path: "loan_id" } },
            rows: [
              {
                id: "loan",
                columns: [
                  {
                    id: "detail",
                    span: 8,
                    blocks: [
                      {
                        id: "loan",
                        type: "record",
                        title: "Loan and handover",
                        fieldIds: [
                          field("loans.loan_no"),
                          field("loans.requester_name"),
                          field("loans.requester_email"),
                          field("loans.organization"),
                          field("loans.kits"),
                          field("loans.items"),
                          field("loans.start_date"),
                          field("loans.due_date"),
                          field("loans.returned_at"),
                          field("loans.status"),
                          field("loans.availability_confirmed"),
                          field("loans.agreement_sent"),
                          field("loans.purpose"),
                          field("loans.notes"),
                        ],
                        editableFieldIds: [
                          field("loans.kits"),
                          field("loans.items"),
                          field("loans.start_date"),
                          field("loans.due_date"),
                          field("loans.returned_at"),
                          field("loans.status"),
                          field("loans.availability_confirmed"),
                          field("loans.notes"),
                        ],
                      },
                    ],
                  },
                  {
                    id: "actions",
                    span: 4,
                    blocks: [
                      {
                        id: "actions",
                        type: "actions",
                        actions: [
                          {
                            id: "approve",
                            label: "Approve loan",
                            icon: "check",
                            kind: "workflow",
                            launcherId: launcher("approve_loan_custom_app"),
                            inputs: { loan: { source: "RECORD", path: "id" } },
                            confirm: "Approve this loan after checking availability?",
                            availableWhen: {
                              query: formula(
                                "from table ",
                                table("loans"),
                                "\nwhere record.id = @params.loan_id and ",
                                field("loans.status"),
                                " = 'requested'\nlimit 1",
                              ),
                            },
                          },
                          {
                            id: "send-agreement",
                            label: "Send agreement and start loan",
                            icon: "file-check",
                            kind: "workflow",
                            launcherId: launcher("send_loan_agreement_custom_app"),
                            inputs: { loan: { source: "RECORD", path: "id" } },
                            confirm: "Send the agreement and mark the approved loan active?",
                            availableWhen: {
                              query: formula(
                                "from table ",
                                table("loans"),
                                "\nwhere record.id = @params.loan_id and ",
                                field("loans.status"),
                                " = 'approved' and ",
                                field("loans.agreement_sent"),
                                " = false\nlimit 1",
                              ),
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                id: "updates",
                columns: [
                  {
                    id: "comments",
                    span: 12,
                    blocks: [
                      {
                        id: "comments",
                        type: "comments",
                        title: "Loan notes and updates",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
  documentTemplates: [
    {
      key: "asset_label",
      table: "items",
      starterId: "label",
      name: "Asset label",
      description: "Printable inventory label used to identify and scan one item.",
      source: formula(
        "from table ",
        table("items"),
        "\nselect ",
        field("items.asset_id"),
        ", ",
        field("items.name"),
        ", ",
        field("items.location"),
        "\nwhere record.id = '{{ record.id }}'\nlimit 1",
      ),
      enabled: true,
    },
    {
      key: "loan_agreement",
      table: "loans",
      starterId: "loan-agreement",
      name: "Loan agreement",
      description: "Printable loan agreement for one inventory loan.",
      source: formula(
        "from table ",
        table("loans"),
        "\nselect ",
        field("loans.loan_no"),
        " as loan_number",
        ", ",
        field("loans.requester_name"),
        " as borrower_name",
        ", ",
        field("loans.requester_email"),
        " as borrower_email",
        ", ",
        field("loans.organization"),
        " as borrower_organization",
        ", ",
        field("loans.kits"),
        ", ",
        field("loans.start_date"),
        " as loan_start",
        ", ",
        field("loans.due_date"),
        " as return_due",
        ", ",
        field("loans.purpose"),
        "\nwhere record.id = '{{ record.id }}'\nlimit 1",
      ),
      enabled: true,
    },
  ],
  emailTemplates: [
    {
      key: "loan_agreement_ready",
      name: "Loan agreement ready",
      description: "Sends a private download link for a generated loan agreement.",
      subject: "Loan agreement {{ data.loanNumber | default: 'ready' }}",
      html: `<main style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;max-width:640px;margin:0 auto;padding:32px;">
  <h1 style="font-size:24px;margin:0 0 16px;">Your loan agreement is ready</h1>
  <p>Hello {{ data.requesterName | default: "there" }},</p>
  <p>Your agreement{% if data.loanNumber %} for loan <strong>{{ data.loanNumber }}</strong>{% endif %} has been prepared.{% if data.dueDate %} The planned return date is <strong>{{ data.dueDate }}</strong>.{% endif %}</p>
  <p style="margin:24px 0;"><a href="{{ data.agreement.url }}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;">Download agreement</a></p>
  <p style="color:#6b7280;font-size:14px;">This private link expires automatically.</p>
</main>`,
      sampleData: {
        requesterName: "Alex Morgan",
        loanNumber: "LOAN-2026-0001",
        dueDate: "31 July 2026",
        agreement: {
          url: "https://cloud.example.org/share/grids/documents/example",
        },
      },
      enabled: true,
    },
  ],
  workflows: [
    {
      key: "cancel_loan",
      name: "Cancel requested loan",
      description: "Lets the requester cancel only a loan that is still awaiting review.",
      source: `inputs:
  loan:
    type: record
    table: Loans
    label: Loan
    required: true
steps:
  - if:
      notEquals:
        - \${{ inputs.loan.Status }}
        - [requested]
    then:
      - fail:
          message: Only a requested loan can be cancelled.
  - updateRecord:
      record: inputs.loan
      set:
        Status: [cancelled]
  - succeed:
      message: "Loan \${{ inputs.loan.Loan number }} cancelled."`,
      enabled: true,
    },
    {
      key: "approve_loan",
      name: "Approve equipment loan",
      description: "Approves one requested loan after dates and availability were checked.",
      source: `inputs:
  loan:
    type: record
    table: Loans
    label: Loan
    required: true
steps:
  - if:
      notEquals:
        - \${{ inputs.loan.Status }}
        - [requested]
    then:
      - fail:
          message: Only a requested loan can be approved.
  - if:
      notEquals:
        - \${{ inputs.loan.Schedule valid }}
        - true
    then:
      - fail:
          message: The due date must be on or after the requested start date.
  - if:
      notEquals:
        - \${{ inputs.loan.Availability confirmed }}
        - true
    then:
      - fail:
          message: Confirm kit, item, and date availability before approval.
  - updateRecord:
      record: inputs.loan
      set:
        Status: [approved]
  - succeed:
      message: "Loan \${{ inputs.loan.Loan number }} approved."`,
      enabled: true,
    },
    {
      key: "send_loan_agreement",
      name: "Send approved loan agreement",
      description: "Generates and emails an agreement after an admin has approved the loan and confirmed availability.",
      source: `inputs:
  loan:
    type: record
    table: Loans
    label: Loan
    required: true
steps:
  - if:
      notEquals:
        - \${{ inputs.loan.Status }}
        - [approved]
    then:
      - fail:
          message: Approve this loan after checking availability before sending its agreement.
  - if:
      equals:
        - \${{ inputs.loan.Agreement sent }}
        - true
    then:
      - fail:
          message: This agreement was already sent. Open the generated documents to download or share it again.
  - if:
      notEquals:
        - \${{ inputs.loan.Availability confirmed }}
        - true
    then:
      - fail:
          message: Confirm kit, item, and date availability before sending the agreement.
  - if:
      notEquals:
        - \${{ inputs.loan.Schedule valid }}
        - true
    then:
      - fail:
          message: The due date must be on or after the requested start date.
  - if:
      not:
        exists: inputs.loan.Requester email
    then:
      - fail:
          message: Add a requester email address before sending this agreement.
  - if:
      endsWith:
        - \${{ inputs.loan.Requester email }}
        - .test
    then:
      - fail:
          message: Replace the sample requester email before sending a real agreement.
  - generateDocument:
      template: Loan agreement
      record: inputs.loan
      saveAs: agreementPdf
  - createDocumentLink:
      document: agreementPdf
      expiresIn: 30d
      saveAs: agreementLink
  - sendEmail:
      template: Loan agreement ready
      to:
        - email: \${{ inputs.loan.Requester email }}
      data:
        agreement: \${{ agreementLink }}
        loanNumber: \${{ inputs.loan.Loan number }}
        requesterName: \${{ inputs.loan.Requester name }}
        dueDate: \${{ inputs.loan.Due date }}
  - updateRecord:
      record: inputs.loan
      set:
        Agreement sent: true
        Status: [active]
  - succeed:
      message: "Agreement for loan \${{ inputs.loan.Loan number }} sent."`,
      enabled: true,
    },
    {
      key: "report_item_defect",
      name: "Report damaged item",
      description: "Moves a scanned inventory item into maintenance and marks it as needing repair.",
      source: `inputs:
  item:
    type: record
    table: Items
    label: Inventory item
    required: true
steps:
  - if:
      equals:
        - \${{ inputs.item.Status }}
        - [maintenance]
    then:
      - fail:
          message: "Item \${{ inputs.item.Asset ID }} is already in maintenance."
  - updateRecord:
      record: inputs.item
      set:
        Status: [maintenance]
        Condition: [repair]
  - succeed:
      message: "Item \${{ inputs.item.Asset ID }} · \${{ inputs.item.Name }} moved to maintenance."`,
      enabled: true,
    },
    {
      key: "return_loan_item",
      name: "Mark loan item as returned",
      description: "Uses one selected loan for the scanner session, then records the condition of every scanned item.",
      source: `inputs:
  loan:
    type: record
    table: Loans
    label: Loan agreement
    description: Select the active loan being returned.
    required: true
  item:
    type: record
    table: Items
    label: Returned item
    required: true
  condition:
    type: select
    label: Returned condition
    description: Assess this item after scanning it.
    options:
      - good
      - used
      - repair
    required: true
steps:
  - if:
      notEquals:
        - \${{ inputs.loan.Status }}
        - [active]
    then:
      - fail:
          message: "Loan \${{ inputs.loan.Loan number }} is not active."
  - if:
      not:
        includes:
          - \${{ inputs.loan.Loaned items }}
          - \${{ inputs.item }}
    then:
      - fail:
          message: "Item \${{ inputs.item.Asset ID }} does not belong to loan \${{ inputs.loan.Loan number }}."
  - if:
      notEquals:
        - \${{ inputs.item.Status }}
        - [in_use]
    then:
      - fail:
          message: "Item \${{ inputs.item.Asset ID }} is not currently in use."
  - if:
      equals:
        - \${{ inputs.condition }}
        - repair
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: [maintenance]
            Condition: [repair]
      - succeed:
          message: "Item \${{ inputs.item.Asset ID }} returned for loan \${{ inputs.loan.Loan number }} and moved to maintenance."
  - updateRecord:
      record: inputs.item
      set:
        Status: [available]
        Condition:
          - \${{ inputs.condition }}
  - succeed:
      message: "Item \${{ inputs.item.Asset ID }} returned for loan \${{ inputs.loan.Loan number }} in \${{ inputs.condition }} condition."`,
      enabled: true,
    },
  ],
  workflowLaunchers: [
    {
      key: "cancel_loan_custom_app",
      workflow: "cancel_loan",
      name: "Cancel requested loan",
      config: { kind: "customApp", inputMode: "prompt" },
      enabled: true,
    },
    {
      key: "approve_loan_custom_app",
      workflow: "approve_loan",
      name: "Approve equipment loan",
      config: { kind: "customApp", inputMode: "prompt" },
      enabled: true,
    },
    {
      key: "send_loan_agreement_custom_app",
      workflow: "send_loan_agreement",
      name: "Choose loan to send agreement",
      config: { kind: "customApp", inputMode: "prompt" },
      enabled: true,
    },
    {
      key: "report_item_defect_scanner",
      workflow: "report_item_defect",
      name: "Scan damaged inventory item",
      config: {
        kind: "scanner",
        input: "item",
        resolve: { by: "field", field: "Asset ID" },
      },
      enabled: true,
    },
    {
      key: "return_loan_item_scanner",
      workflow: "return_loan_item",
      name: "Return items for one loan",
      config: {
        kind: "scanner",
        inputSources: {
          loan: { kind: "session" },
          item: {
            kind: "scan",
            value: "record",
            resolve: { by: "field", field: "Asset ID" },
          },
          condition: { kind: "afterScan" },
        },
      },
      enabled: true,
    },
  ],
};
