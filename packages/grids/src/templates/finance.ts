import { currentMonthDate, field, form, formula, type GridTemplate, launcher, record, table, view, viewColumns } from "./types";

const monthlySpendSource = () =>
  formula(
    "from table ",
    table("transactions"),
    "\nwhere ",
    field("transactions.type"),
    " = 'expense'\ngroup by ",
    field("transactions.date"),
    " by month\naggregate sum(",
    field("transactions.amount"),
    ") as monthly_spend\nsort ",
    field("transactions.date"),
    " asc",
  );

export const financeTemplate: GridTemplate = {
  id: "finance",
  name: "Personal finance",
  description: "Track accounts, purchases, budgets, and receipt processing in one place.",
  highlights: [
    "Transactions, budgets, and a purchase form",
    "Spending, budget, and merchant overview",
    "Guided receipt processing and email delivery",
  ],
  icon: "ti ti-wallet",
  baseName: "Personal Finance",
  baseDescription: "Track personal spending, income, budgets, and recent purchases.",
  tables: [
    {
      key: "accounts",
      name: "Accounts",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "Account name shown on transactions and budgets.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-credit-card",
        },
        {
          key: "kind",
          name: "Kind",
          description: "Account type used for filtering and summaries.",
          type: "select",
          icon: "ti ti-category",
          config: {
            options: [
              { id: "checking", label: "Checking", color: "#3b82f6" },
              { id: "cash", label: "Cash", color: "#22c55e" },
              { id: "savings", label: "Savings", color: "#a855f7" },
              { id: "credit", label: "Credit card", color: "#f59e0b" },
            ],
          },
        },
        {
          key: "opening_balance",
          name: "Opening balance",
          description: "Starting balance before imported or entered transactions.",
          type: "number",
          icon: "ti ti-currency-euro",
          config: {
            precision: 16,
            decimalPlaces: 2,
            unit: "EUR",
            unitPosition: "suffix",
          },
        },
      ],
    },
    {
      key: "categories",
      name: "Categories",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "Category name shown on merchants, transactions, and budgets.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-tag",
        },
        {
          key: "kind",
          name: "Kind",
          description: "Whether this category tracks income or expense.",
          type: "select",
          icon: "ti ti-arrows-exchange",
          config: {
            options: [
              { id: "income", label: "Income", color: "#22c55e" },
              { id: "expense", label: "Expense", color: "#ef4444" },
            ],
          },
        },
        {
          key: "fixed",
          name: "Fixed",
          description: "Marks recurring categories such as rent or utilities.",
          type: "boolean",
          icon: "ti ti-lock",
          defaultValue: false,
        },
      ],
    },
    {
      key: "merchants",
      name: "Merchants",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "Merchant, vendor, employer, or payee name.",
          type: "text",
          required: true,
          presentable: true,
          icon: "ti ti-building-store",
        },
        {
          key: "default_category",
          name: "Default category",
          description: "Category suggested for future transactions from this merchant.",
          type: "relation",
          icon: "ti ti-tag",
          config: { targetTableId: table("categories"), cardinality: "single" },
        },
        {
          key: "website",
          name: "Website",
          description: "Merchant website kept as a transaction reference.",
          type: "text",
          config: { regex: "^https?://.+" },
          icon: "ti ti-world",
        },
      ],
    },
    {
      key: "transactions",
      name: "Transactions",
      fields: [
        {
          key: "transaction_ref",
          name: "Transaction reference",
          description: "Generated monthly reference for this transaction.",
          type: "id",
          config: {
            strategy: "date_sequence",
            prefix: "TX-",
            period: "month",
            padding: 4,
          },
          presentable: true,
          icon: "ti ti-id",
        },
        {
          key: "date",
          name: "Date",
          description: "Transaction date.",
          type: "date",
          required: true,
          icon: "ti ti-calendar",
        },
        {
          key: "merchant",
          name: "Merchant",
          description: "Merchant or payee for this transaction.",
          type: "relation",
          required: true,
          icon: "ti ti-building-store",
          config: { targetTableId: table("merchants"), cardinality: "single" },
        },
        {
          key: "account",
          name: "Account",
          description: "Account this transaction belongs to.",
          type: "relation",
          required: true,
          icon: "ti ti-credit-card",
          config: { targetTableId: table("accounts"), cardinality: "single" },
        },
        {
          key: "category",
          name: "Category",
          description: "Budget or reporting category for this transaction.",
          type: "relation",
          required: true,
          icon: "ti ti-tag",
          config: { targetTableId: table("categories"), cardinality: "single" },
        },
        {
          key: "merchant_name",
          name: "Merchant name",
          description: "Lookup label copied from the related merchant.",
          type: "lookup",
          icon: "ti ti-hierarchy",
          config: {
            relationFieldId: field("transactions.merchant"),
            targetFieldId: field("merchants.name"),
          },
        },
        {
          key: "merchant_website",
          name: "Merchant website",
          description: "Lookup website copied from the related merchant.",
          type: "lookup",
          icon: "ti ti-qrcode",
          config: {
            relationFieldId: field("transactions.merchant"),
            targetFieldId: field("merchants.website"),
          },
        },
        {
          key: "category_name",
          name: "Category name",
          description: "Lookup label copied from the related category.",
          type: "lookup",
          icon: "ti ti-hierarchy",
          config: {
            relationFieldId: field("transactions.category"),
            targetFieldId: field("categories.name"),
          },
        },
        {
          key: "type",
          name: "Type",
          description: "Transaction direction for income, expense, or transfer reporting.",
          type: "select",
          required: true,
          icon: "ti ti-arrows-exchange",
          config: {
            options: [
              { id: "expense", label: "Expense", color: "#ef4444" },
              { id: "income", label: "Income", color: "#22c55e" },
              { id: "transfer", label: "Transfer", color: "#94a3b8" },
            ],
          },
        },
        {
          key: "amount",
          name: "Amount",
          description: "Transaction amount in euros.",
          type: "number",
          required: true,
          icon: "ti ti-currency-euro",
          config: {
            precision: 16,
            decimalPlaces: 2,
            min: "0",
            unit: "EUR",
            unitPosition: "suffix",
          },
        },
        {
          key: "cleared",
          name: "Cleared",
          description: "Whether the transaction has cleared the account.",
          type: "boolean",
          icon: "ti ti-circle-check",
          defaultValue: false,
        },
        {
          key: "notes",
          name: "Notes",
          description: "Optional notes about this transaction.",
          type: "longtext",
          icon: "ti ti-notes",
        },
        {
          key: "receipt_email",
          name: "Receipt email",
          description: "Recipient used by the receipt workflow.",
          type: "text",
          required: true,
          icon: "ti ti-mail",
          config: { regex: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
          defaultValue: "receipts@example.test",
        },
        {
          key: "receipt_sent",
          name: "Receipt sent",
          description: "Set once the receipt workflow has succeeded, so it is not replayed accidentally.",
          type: "boolean",
          icon: "ti ti-mail-check",
          defaultValue: false,
        },
      ],
    },
    {
      key: "budgets",
      name: "Budgets",
      fields: [
        {
          key: "month",
          name: "Month",
          description: "Budget month.",
          type: "date",
          required: true,
          presentable: true,
          icon: "ti ti-calendar-month",
        },
        {
          key: "category",
          name: "Category",
          description: "Expense category this budget limits.",
          type: "relation",
          required: true,
          icon: "ti ti-tag",
          config: { targetTableId: table("categories"), cardinality: "single" },
        },
        {
          key: "limit",
          name: "Limit",
          description: "Planned spending limit for the month and category.",
          type: "number",
          required: true,
          icon: "ti ti-currency-euro",
          config: {
            precision: 16,
            decimalPlaces: 2,
            unit: "EUR",
            unitPosition: "suffix",
          },
        },
      ],
    },
  ],
  records: [
    {
      key: "accounts.main",
      table: "accounts",
      values: {
        name: "Main account",
        kind: ["checking"],
        opening_balance: "2450.00",
      },
    },
    {
      key: "accounts.savings",
      table: "accounts",
      values: {
        name: "Savings",
        kind: ["savings"],
        opening_balance: "8400.00",
      },
    },
    {
      key: "accounts.cash",
      table: "accounts",
      values: { name: "Cash", kind: ["cash"], opening_balance: "120.00" },
    },
    {
      key: "accounts.card",
      table: "accounts",
      values: { name: "Visa", kind: ["credit"], opening_balance: "0.00" },
    },
    {
      key: "categories.salary",
      table: "categories",
      values: { name: "Salary", kind: ["income"], fixed: true },
    },
    {
      key: "categories.groceries",
      table: "categories",
      values: { name: "Groceries", kind: ["expense"], fixed: false },
    },
    {
      key: "categories.rent",
      table: "categories",
      values: { name: "Rent", kind: ["expense"], fixed: true },
    },
    {
      key: "categories.transport",
      table: "categories",
      values: { name: "Transport", kind: ["expense"], fixed: false },
    },
    {
      key: "categories.books",
      table: "categories",
      values: { name: "Books", kind: ["expense"], fixed: false },
    },
    {
      key: "categories.food",
      table: "categories",
      values: { name: "Food & coffee", kind: ["expense"], fixed: false },
    },
    {
      key: "categories.utilities",
      table: "categories",
      values: { name: "Utilities", kind: ["expense"], fixed: true },
    },
    {
      key: "merchants.employer",
      table: "merchants",
      values: {
        name: "Employer GmbH",
        default_category: [record("categories.salary")],
        website: "https://employer.example",
      },
    },
    {
      key: "merchants.landlord",
      table: "merchants",
      values: {
        name: "Landlord",
        default_category: [record("categories.rent")],
        website: "https://rent.example",
      },
    },
    {
      key: "merchants.market",
      table: "merchants",
      values: {
        name: "Local Market",
        default_category: [record("categories.groceries")],
        website: "https://market.example",
      },
    },
    {
      key: "merchants.transit",
      table: "merchants",
      values: {
        name: "City Transit",
        default_category: [record("categories.transport")],
        website: "https://transit.example",
      },
    },
    {
      key: "merchants.bookshop",
      table: "merchants",
      values: {
        name: "Bookshop",
        default_category: [record("categories.books")],
        website: "https://bookshop.example",
      },
    },
    {
      key: "merchants.cafe",
      table: "merchants",
      values: {
        name: "Corner Cafe",
        default_category: [record("categories.food")],
        website: "https://cafe.example",
      },
    },
    {
      key: "merchants.power",
      table: "merchants",
      values: {
        name: "Power Utility",
        default_category: [record("categories.utilities")],
        website: "https://power.example",
      },
    },
    {
      key: "transactions.salary_apr",
      table: "transactions",
      values: {
        date: "2026-04-01",
        merchant: [record("merchants.employer")],
        account: [record("accounts.main")],
        category: [record("categories.salary")],
        type: ["income"],
        amount: "3200.00",
        cleared: true,
      },
    },
    {
      key: "transactions.rent_apr",
      table: "transactions",
      values: {
        date: "2026-04-02",
        merchant: [record("merchants.landlord")],
        account: [record("accounts.main")],
        category: [record("categories.rent")],
        type: ["expense"],
        amount: "980.00",
        cleared: true,
      },
    },
    {
      key: "transactions.market_apr",
      table: "transactions",
      values: {
        date: "2026-04-05",
        merchant: [record("merchants.market")],
        account: [record("accounts.card")],
        category: [record("categories.groceries")],
        type: ["expense"],
        amount: "76.40",
        cleared: true,
      },
    },
    {
      key: "transactions.cafe_apr",
      table: "transactions",
      values: {
        date: "2026-04-09",
        merchant: [record("merchants.cafe")],
        account: [record("accounts.card")],
        category: [record("categories.food")],
        type: ["expense"],
        amount: "14.80",
        cleared: true,
      },
    },
    {
      key: "transactions.books_apr",
      table: "transactions",
      values: {
        date: "2026-04-18",
        merchant: [record("merchants.bookshop")],
        account: [record("accounts.cash")],
        category: [record("categories.books")],
        type: ["expense"],
        amount: "28.90",
        cleared: true,
      },
    },
    {
      key: "transactions.salary_may",
      table: "transactions",
      values: {
        date: currentMonthDate(1),
        merchant: [record("merchants.employer")],
        account: [record("accounts.main")],
        category: [record("categories.salary")],
        type: ["income"],
        amount: "3200.00",
        cleared: true,
      },
    },
    {
      key: "transactions.rent_may",
      table: "transactions",
      values: {
        date: currentMonthDate(2),
        merchant: [record("merchants.landlord")],
        account: [record("accounts.main")],
        category: [record("categories.rent")],
        type: ["expense"],
        amount: "980.00",
        cleared: true,
      },
    },
    {
      key: "transactions.power_may",
      table: "transactions",
      values: {
        date: currentMonthDate(3),
        merchant: [record("merchants.power")],
        account: [record("accounts.main")],
        category: [record("categories.utilities")],
        type: ["expense"],
        amount: "92.30",
        cleared: true,
      },
    },
    {
      key: "transactions.market_may_1",
      table: "transactions",
      values: {
        date: currentMonthDate(4),
        merchant: [record("merchants.market")],
        account: [record("accounts.card")],
        category: [record("categories.groceries")],
        type: ["expense"],
        amount: "82.40",
        cleared: true,
      },
    },
    {
      key: "transactions.transit_may",
      table: "transactions",
      values: {
        date: currentMonthDate(6),
        merchant: [record("merchants.transit")],
        account: [record("accounts.card")],
        category: [record("categories.transport")],
        type: ["expense"],
        amount: "58.00",
        cleared: true,
      },
    },
    {
      key: "transactions.cafe_may_1",
      table: "transactions",
      values: {
        date: currentMonthDate(8),
        merchant: [record("merchants.cafe")],
        account: [record("accounts.card")],
        category: [record("categories.food")],
        type: ["expense"],
        amount: "12.60",
        cleared: true,
      },
    },
    {
      key: "transactions.bookshop_may",
      table: "transactions",
      values: {
        date: currentMonthDate(9),
        merchant: [record("merchants.bookshop")],
        account: [record("accounts.cash")],
        category: [record("categories.books")],
        type: ["expense"],
        amount: "31.90",
        cleared: true,
      },
    },
    {
      key: "transactions.market_may_2",
      table: "transactions",
      values: {
        date: currentMonthDate(11),
        merchant: [record("merchants.market")],
        account: [record("accounts.card")],
        category: [record("categories.groceries")],
        type: ["expense"],
        amount: "64.20",
        cleared: false,
      },
    },
    {
      key: "transactions.cafe_may_2",
      table: "transactions",
      values: {
        date: currentMonthDate(12),
        merchant: [record("merchants.cafe")],
        account: [record("accounts.card")],
        category: [record("categories.food")],
        type: ["expense"],
        amount: "9.90",
        cleared: false,
      },
    },
    {
      key: "budgets.rent",
      table: "budgets",
      values: {
        month: currentMonthDate(1),
        category: [record("categories.rent")],
        limit: "980.00",
      },
    },
    {
      key: "budgets.groceries",
      table: "budgets",
      values: {
        month: currentMonthDate(1),
        category: [record("categories.groceries")],
        limit: "450.00",
      },
    },
    {
      key: "budgets.transport",
      table: "budgets",
      values: {
        month: currentMonthDate(1),
        category: [record("categories.transport")],
        limit: "120.00",
      },
    },
    {
      key: "budgets.books",
      table: "budgets",
      values: {
        month: currentMonthDate(1),
        category: [record("categories.books")],
        limit: "80.00",
      },
    },
    {
      key: "budgets.food",
      table: "budgets",
      values: {
        month: currentMonthDate(1),
        category: [record("categories.food")],
        limit: "160.00",
      },
    },
    {
      key: "budgets.previous_groceries",
      table: "budgets",
      values: {
        month: currentMonthDate(1, -1),
        category: [record("categories.groceries")],
        limit: "400.00",
      },
    },
  ],
  views: [
    {
      key: "recent_transactions",
      table: "transactions",
      name: "Recent transactions",
      shared: true,
      source: formula(
        "from table ",
        table("transactions"),
        "\nselect ",
        field("transactions.transaction_ref"),
        ", ",
        field("transactions.date"),
        ", ",
        field("transactions.merchant"),
        ", ",
        field("transactions.merchant_website"),
        ", ",
        field("transactions.category"),
        ", ",
        field("transactions.type"),
        ", ",
        field("transactions.amount"),
        ", ",
        field("transactions.cleared"),
        "\nsort ",
        field("transactions.date"),
        " desc\nlimit 50",
      ),
      ui: {
        columns: [
          { fieldId: field("transactions.transaction_ref") },
          { fieldId: field("transactions.date") },
          { fieldId: field("transactions.merchant") },
          {
            fieldId: field("transactions.merchant_website"),
            label: "Merchant website",
          },
          { fieldId: field("transactions.category") },
          { fieldId: field("transactions.type") },
          { fieldId: field("transactions.amount") },
          { fieldId: field("transactions.cleared") },
        ],
      },
    },
    {
      key: "transaction_calendar",
      table: "transactions",
      name: "Transaction calendar",
      shared: true,
      source: formula(
        "from table ",
        table("transactions"),
        "\nselect ",
        field("transactions.date"),
        ", ",
        field("transactions.merchant"),
        ", ",
        field("transactions.category"),
        ", ",
        field("transactions.type"),
        ", ",
        field("transactions.amount"),
        "\nsort ",
        field("transactions.date"),
        " desc\nlimit 100",
      ),
      ui: {
        displayConfig: {
          mode: "calendar",
          calendar: { dateFieldId: field("transactions.date") },
        },
      },
    },
    {
      key: "budgets",
      table: "budgets",
      name: "Monthly budgets",
      shared: true,
      source: formula(
        "from table ",
        table("budgets"),
        "\nselect ",
        field("budgets.month"),
        ", ",
        field("budgets.category"),
        ", ",
        field("budgets.limit"),
        "\nsort ",
        field("budgets.limit"),
        " desc",
      ),
    },
  ],
  forms: [
    {
      key: "log_expense",
      table: "transactions",
      name: "Log expense",
      config: {
        title: "Log expense",
        description: "Add a purchase as an expense transaction.",
        submitLabel: "Log purchase",
        successMessage: "Expense logged.",
        fields: [
          {
            kind: "user_input",
            fieldId: field("transactions.date"),
            label: "Date",
            helpText: "Purchase date.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("transactions.merchant"),
            label: "Merchant",
            helpText: "Where the purchase happened.",
            required: true,
            inlineCreate: {
              enabled: true,
              fields: [
                {
                  fieldId: field("merchants.name"),
                  label: "Merchant name",
                  helpText: "Shop, vendor, or person.",
                  required: true,
                },
                {
                  fieldId: field("merchants.website"),
                  label: "Website",
                  helpText: "Optional merchant URL.",
                },
              ],
            },
          },
          {
            kind: "user_input",
            fieldId: field("transactions.account"),
            label: "Account",
            helpText: "Account or payment source.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("transactions.category"),
            label: "Category",
            helpText: "Budget or spending category.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("transactions.amount"),
            label: "Amount",
            helpText: "Expense amount.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("transactions.notes"),
            label: "Notes",
            helpText: "Receipt details or context.",
          },
          {
            kind: "user_input",
            fieldId: field("transactions.receipt_email"),
            label: "Receipt email",
            helpText: "Recipient used by the receipt workflow.",
            required: true,
          },
          {
            kind: "form_value",
            fieldId: field("transactions.type"),
            value: ["expense"],
          },
          {
            kind: "form_value",
            fieldId: field("transactions.cleared"),
            value: false,
          },
          {
            kind: "form_value",
            fieldId: field("transactions.receipt_sent"),
            value: false,
          },
        ],
      },
    },
  ],
  documentTemplates: [
    {
      key: "transaction_receipt",
      table: "transactions",
      starterId: "record-detail",
      name: "Transaction receipt",
      description: "Printable receipt summary for one transaction.",
      source: formula(
        "from table ",
        table("transactions"),
        "\nselect ",
        field("transactions.transaction_ref"),
        " as reference, ",
        field("transactions.date"),
        ", ",
        field("transactions.merchant_name"),
        " as merchant_label, ",
        field("transactions.category_name"),
        " as category_label, ",
        field("transactions.type"),
        ", ",
        field("transactions.amount"),
        ", ",
        field("transactions.cleared"),
        ", ",
        field("transactions.receipt_sent"),
        ", ",
        field("transactions.notes"),
        "\nwhere record.id = '{{ record.id }}'\nlimit 1",
      ),
      enabled: true,
    },
  ],
  emailTemplates: [
    {
      key: "transaction_receipt_ready",
      name: "Transaction receipt ready",
      description: "Sends a private download link for a transaction receipt.",
      subject: "Receipt {{ data.reference }}",
      html: `<main style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;max-width:640px;margin:0 auto;padding:32px;">
  <h1 style="font-size:24px;margin:0 0 16px;">Transaction receipt</h1>
  <p>The receipt for <strong>{{ data.reference }}</strong>{% if data.merchant %} at {{ data.merchant }}{% endif %} is ready.</p>
  <p style="margin:24px 0;"><a href="{{ data.receipt.url }}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;">Download receipt</a></p>
  <p style="color:#6b7280;font-size:14px;">This private link expires automatically.</p>
</main>`,
      sampleData: {
        reference: "TX-2026-0042",
        merchant: "Office Supply GmbH",
        receipt: {
          url: "https://cloud.example.org/share/grids/documents/example",
        },
      },
      enabled: true,
    },
  ],
  workflows: [
    {
      key: "clear_and_send_receipt",
      name: "Clear and send receipt",
      description: "Creates a receipt link, emails it, and marks the transaction as cleared.",
      source: `inputs:
  transaction:
    type: record
    table: Transactions
    label: Transaction
    required: true
steps:
  - if:
      notEquals:
        - \${{ inputs.transaction.Type }}
        - [expense]
    then:
      - fail:
          message: Receipts can only be sent for expense transactions.
  - if:
      equals:
        - \${{ inputs.transaction.Receipt sent }}
        - true
    then:
      - fail:
          message: This receipt was already sent. Open the generated documents to download or share it again.
  - if:
      not:
        exists: inputs.transaction.Receipt email
    then:
      - fail:
          message: Add a receipt email address before processing this transaction.
  - if:
      endsWith:
        - \${{ inputs.transaction.Receipt email }}
        - .test
    then:
      - fail:
          message: Replace the sample receipt email before sending a real receipt.
  - generateDocument:
      template: Transaction receipt
      record: inputs.transaction
      saveAs: receiptPdf
  - createDocumentLink:
      document: receiptPdf
      expiresIn: 30d
      saveAs: receiptLink
  - sendEmail:
      template: Transaction receipt ready
      to:
        - email: \${{ inputs.transaction.Receipt email }}
      data:
        receipt: \${{ receiptLink }}
        reference: \${{ inputs.transaction.Transaction reference }}
        merchant: \${{ inputs.transaction.Merchant name }}
  - updateRecord:
      record: inputs.transaction
      set:
        Cleared: true
        Receipt sent: true
  - succeed:
      message: "Receipt \${{ inputs.transaction.Transaction reference }} sent and transaction cleared."`,
      enabled: true,
    },
  ],
  workflowLaunchers: [
    {
      key: "clear_and_send_receipt_custom_app",
      workflow: "clear_and_send_receipt",
      name: "Choose transaction to process receipt",
      config: { kind: "customApp", inputMode: "prompt" },
      enabled: true,
    },
  ],
  customApps: [
    {
      key: "overview",
      definition: {
        schemaVersion: 4,
        kind: "grids.custom-app",
        name: "Finance overview",
        startPageId: "overview",
        pages: [
          {
            id: "overview",
            title: "Finance overview",
            navigation: {
              visible: true,
            },
            parameters: {},
            rows: [
              {
                id: "r-stats",
                columns: [
                  {
                    id: "w-income-column",
                    span: 3,
                    blocks: [
                      {
                        id: "w-income",
                        type: "metrics",
                        title: "Income",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("transactions"),
                            "\nwhere ",
                            field("transactions.type"),
                            " = 'income'\naggregate sum(",
                            field("transactions.amount"),
                            ") as total_income",
                          ),
                        },
                      },
                    ],
                  },
                  {
                    id: "w-spend-column",
                    span: 3,
                    blocks: [
                      {
                        id: "w-spend",
                        type: "metrics",
                        title: "Spend",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("transactions"),
                            "\nwhere ",
                            field("transactions.type"),
                            " = 'expense'\naggregate sum(",
                            field("transactions.amount"),
                            ") as total_spend",
                          ),
                        },
                      },
                    ],
                  },
                  {
                    id: "w-tx-column",
                    span: 3,
                    blocks: [
                      {
                        id: "w-tx",
                        type: "metrics",
                        title: "Transactions",
                        source: {
                          kind: "gql",
                          query: formula("from table ", table("transactions"), "\naggregate count(*) as transaction_count"),
                        },
                      },
                    ],
                  },
                  {
                    id: "w-budget-column",
                    span: 3,
                    blocks: [
                      {
                        id: "w-budget",
                        type: "metrics",
                        title: "Budget",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("budgets"),
                            "\nwhere YEAR(",
                            field("budgets.month"),
                            ") = YEAR(TODAY()) and MONTH(",
                            field("budgets.month"),
                            ") = MONTH(TODAY())\naggregate sum(",
                            field("budgets.limit"),
                            ") as total_budget",
                          ),
                        },
                      },
                    ],
                  },
                ],
              },
              {
                id: "r-charts",
                columns: [
                  {
                    id: "w-spend-cat-column",
                    span: 6,
                    blocks: [
                      {
                        id: "w-spend-cat",
                        type: "chart",
                        title: "Spend by category",
                        subtitle: "Expense transactions only",
                        chartType: "donut",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("transactions"),
                            "\njoin table ",
                            table("categories"),
                            " as category on ",
                            field("transactions.category"),
                            " = category.id\nwhere ",
                            field("transactions.type"),
                            " = 'expense'\ngroup by category.",
                            field("categories.name"),
                            "\naggregate sum(",
                            field("transactions.amount"),
                            ") as category_spend\nhaving category_spend > 0\nsort category_spend desc nulls last",
                          ),
                        },
                        limit: 100,
                      },
                    ],
                  },
                  {
                    id: "w-monthly-column",
                    span: 6,
                    blocks: [
                      {
                        id: "w-monthly",
                        type: "chart",
                        title: "Monthly spend",
                        chartType: "bar",
                        source: {
                          kind: "gql",
                          query: monthlySpendSource(),
                        },
                        valueFormat: {
                          style: "number",
                          decimalPlaces: 2,
                          unit: "EUR",
                          unitPosition: "suffix",
                        },
                        yAxisLabel: "EUR",
                        limit: 100,
                      },
                    ],
                  },
                ],
              },
              {
                id: "r-work",
                columns: [
                  {
                    id: "w-recent-column",
                    span: 7,
                    blocks: [
                      {
                        id: "w-recent",
                        type: "records",
                        searchable: true,
                        pageSize: 25,
                        title: "Recent transactions",
                        source: { kind: "view", viewId: view("recent_transactions") },
                        display: {
                          kind: "table",
                          columnIds: viewColumns("recent_transactions"),
                        },
                        rowActions: [
                          {
                            id: "send-receipt",
                            label: "Process receipt",
                            showLabel: true,
                            kind: "workflow",
                            launcherId: launcher("clear_and_send_receipt_custom_app"),
                            inputs: { transaction: { source: "ROW", path: "id" } },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    id: "w-log-column",
                    span: 5,
                    blocks: [
                      {
                        id: "w-log",
                        type: "form",
                        title: "Log a purchase",
                        formId: form("log_expense"),
                        fixedValues: {},
                      },
                    ],
                  },
                ],
              },
              {
                id: "r-budget",
                columns: [
                  {
                    id: "w-budgets-column",
                    span: 6,
                    blocks: [
                      {
                        id: "w-budgets",
                        type: "records",
                        searchable: true,
                        pageSize: 25,
                        title: "Monthly budgets",
                        source: { kind: "view", viewId: view("budgets") },
                        display: {
                          kind: "table",
                          columnIds: viewColumns("budgets"),
                        },
                      },
                    ],
                  },
                  {
                    id: "w-income-chart-column",
                    span: 6,
                    blocks: [
                      {
                        id: "w-income-chart",
                        type: "chart",
                        title: "Monthly income",
                        chartType: "bar",
                        source: {
                          kind: "gql",
                          query: formula(
                            "from table ",
                            table("transactions"),
                            "\nwhere ",
                            field("transactions.type"),
                            " = 'income'\ngroup by ",
                            field("transactions.date"),
                            " by month\naggregate sum(",
                            field("transactions.amount"),
                            ") as monthly_income\nsort ",
                            field("transactions.date"),
                            " asc",
                          ),
                        },
                        valueFormat: {
                          style: "number",
                          decimalPlaces: 2,
                          unit: "EUR",
                          unitPosition: "suffix",
                        },
                        limit: 100,
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
};
