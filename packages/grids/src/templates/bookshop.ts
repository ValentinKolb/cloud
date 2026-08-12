import { createMockCover } from "@valentinkolb/cloud/shared";
import { currentMonthDate, field, form, formula, type GridTemplate, launcher, record, table, view } from "./types";

export const bookshopTemplate: GridTemplate = {
  id: "bookshop",
  name: "Bookshop",
  description: "Manage a book catalog, customers, orders, fulfillment, and invoice delivery.",
  highlights: ["Relational catalog and order tracking", "Sales and fulfillment overview", "Guided invoice generation and email delivery"],
  icon: "ti ti-books",
  baseName: "Bookshop",
  baseDescription: "Inventory and order tracking for a small bookshop.",
  tables: [
    {
      key: "authors",
      name: "Authors",
      description: "People who wrote the books.",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "The author's display name.",
          type: "text",
          config: { maxLength: 200 },
          required: true,
          presentable: true,
          icon: "ti ti-user",
        },
        {
          key: "birth_year",
          name: "Birth year",
          description: "The year the author was born.",
          type: "number",
          config: { min: 1000, max: 3000, integerOnly: true },
          icon: "ti ti-calendar",
        },
        {
          key: "country",
          name: "Country",
          description: "The country most associated with this author.",
          type: "select",
          icon: "ti ti-map-pin",
          config: {
            options: [
              { id: "de", label: "Germany", color: "#ef4444" },
              { id: "uk", label: "United Kingdom", color: "#3b82f6" },
              { id: "us", label: "United States", color: "#10b981" },
              { id: "jp", label: "Japan", color: "#f59e0b" },
            ],
          },
        },
        {
          key: "bio",
          name: "Bio",
          description: "Short internal notes about the author.",
          type: "longtext",
          icon: "ti ti-notes",
        },
      ],
    },
    {
      key: "genres",
      name: "Genres",
      description: "Reusable genre catalog.",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "The genre name shown on books and filters.",
          type: "text",
          config: { maxLength: 80 },
          required: true,
          presentable: true,
          icon: "ti ti-tag",
        },
        {
          key: "description",
          name: "Description",
          description: "Optional notes that explain what belongs in this genre.",
          type: "longtext",
          icon: "ti ti-align-left",
        },
      ],
    },
    {
      key: "books",
      name: "Books",
      description: "Catalog and inventory.",
      displayConfig: {
        mode: "cards",
        cards: {
          imageFieldId: field("books.cover"),
          fieldIds: [field("books.title"), field("books.author"), field("books.genre"), field("books.price"), field("books.in_stock")],
        },
      },
      fields: [
        {
          key: "cover",
          name: "Cover",
          description: "Cover image used in card views.",
          type: "file",
          config: { maxFiles: 1, accept: ["image/*"] },
          hideInTable: true,
          icon: "ti ti-photo",
        },
        {
          key: "title",
          name: "Title",
          description: "The book title shown in catalog and order forms.",
          type: "text",
          config: { maxLength: 200 },
          required: true,
          presentable: true,
          icon: "ti ti-book",
        },
        {
          key: "description",
          name: "Description",
          description: "Catalog notes or a short summary.",
          type: "longtext",
          icon: "ti ti-align-left",
        },
        {
          key: "author",
          name: "Author",
          description: "The author of this book.",
          type: "relation",
          required: true,
          icon: "ti ti-user",
          config: { targetTableId: table("authors"), cardinality: "single" },
        },
        {
          key: "genre",
          name: "Genre",
          description: "The primary genre for this book.",
          type: "relation",
          required: true,
          icon: "ti ti-tags",
          config: { targetTableId: table("genres"), cardinality: "single" },
        },
        {
          key: "isbn",
          name: "ISBN",
          description: "International identifier used for book orders and barcode scans.",
          type: "text",
          config: { regex: "^97[89]-[0-9]-[0-9]{2,5}-[0-9]{3,7}-[0-9X]$" },
          icon: "ti ti-barcode",
        },
        {
          key: "pages",
          name: "Pages",
          description: "Number of pages in the book.",
          type: "number",
          config: { min: 1, integerOnly: true },
          icon: "ti ti-file-text",
        },
        {
          key: "price",
          name: "Price",
          description: "Selling price for one copy.",
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
        {
          key: "published",
          name: "Published",
          description: "Original publication date.",
          type: "date",
          icon: "ti ti-calendar",
        },
        {
          key: "in_stock",
          name: "In stock",
          description: "Whether the book is currently available for sale.",
          type: "boolean",
          defaultValue: true,
          icon: "ti ti-package",
        },
        {
          key: "tags",
          name: "Tags",
          description: "Optional catalog labels for merchandising and filtering.",
          type: "select",
          icon: "ti ti-tags",
          config: {
            multiple: true,
            options: [
              { id: "classic", label: "Classic", color: "#f59e0b" },
              { id: "recommended", label: "Recommended", color: "#22c55e" },
              { id: "sale", label: "On sale", color: "#ef4444" },
            ],
          },
        },
        {
          key: "score",
          name: "Score",
          description: "Internal recommendation score from 0 to 5.",
          type: "number",
          config: { min: 0, max: 5, integerOnly: true },
          icon: "ti ti-star",
        },
        {
          key: "sku",
          name: "SKU",
          description: "Automatically assigned stock keeping number.",
          type: "id",
          config: { strategy: "sequence", prefix: "SKU-", padding: 5 },
          icon: "ti ti-barcode",
        },
        {
          key: "author_country",
          name: "Author country",
          description: "Lookup from the linked author.",
          type: "lookup",
          config: {
            relationFieldId: field("books.author"),
            targetFieldId: field("authors.country"),
          },
          icon: "ti ti-hierarchy",
        },
      ],
    },
    {
      key: "customers",
      name: "Customers",
      description: "Bookshop customers.",
      fields: [
        {
          key: "name",
          name: "Name",
          description: "The customer's display name.",
          type: "text",
          config: { maxLength: 200 },
          required: true,
          presentable: true,
          icon: "ti ti-user",
        },
        {
          key: "email",
          name: "Email",
          description: "Contact address used for order invoices.",
          type: "text",
          config: { regex: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
          required: true,
          icon: "ti ti-mail",
        },
        {
          key: "phone",
          name: "Phone",
          description: "Optional phone number.",
          type: "text",
          config: { maxLength: 40 },
          icon: "ti ti-phone",
        },
        {
          key: "joined",
          name: "Joined",
          description: "Date the customer was first added.",
          type: "date",
          icon: "ti ti-calendar-plus",
        },
        {
          key: "notes",
          name: "Notes",
          description: "Private customer notes and reading interests.",
          type: "longtext",
          icon: "ti ti-notes",
        },
        {
          key: "source",
          name: "Source",
          description: "How this customer first reached the bookshop.",
          type: "select",
          icon: "ti ti-route",
          config: {
            options: [
              { id: "website", label: "Website", color: "#3b82f6" },
              { id: "store", label: "In-store", color: "#22c55e" },
              { id: "referral", label: "Referral", color: "#a855f7" },
            ],
          },
        },
      ],
    },
    {
      key: "orders",
      name: "Orders",
      description: "Customer orders and their fulfillment state.",
      fields: [
        {
          key: "order_no",
          name: "Order number",
          description: "Automatically assigned order number.",
          type: "id",
          config: {
            strategy: "date_sequence",
            prefix: "ORD-",
            period: "year",
            padding: 4,
          },
          presentable: true,
          icon: "ti ti-hash",
        },
        {
          key: "customer",
          name: "Customer",
          description: "Customer who placed the order.",
          type: "relation",
          required: true,
          icon: "ti ti-user",
          config: { targetTableId: table("customers"), cardinality: "single" },
        },
        {
          key: "ordered_at",
          name: "Ordered at",
          description: "Date the order was placed.",
          type: "date",
          required: true,
          icon: "ti ti-calendar",
        },
        {
          key: "status",
          name: "Status",
          description: "Current fulfillment status.",
          type: "select",
          icon: "ti ti-truck-delivery",
          config: {
            options: [
              { id: "new", label: "New", color: "#3b82f6" },
              { id: "shipped", label: "Shipped", color: "#f59e0b" },
              { id: "delivered", label: "Delivered", color: "#22c55e" },
            ],
          },
          required: true,
          defaultValue: ["new"],
        },
        {
          key: "invoice_ready",
          name: "Ready to invoice",
          description: "Confirm that all order lines are complete before the invoice workflow can run.",
          type: "boolean",
          defaultValue: false,
          icon: "ti ti-file-check",
        },
        {
          key: "invoice_sent",
          name: "Invoice sent",
          description: "Set once the invoice workflow has succeeded, so it is not replayed accidentally.",
          type: "boolean",
          defaultValue: false,
          icon: "ti ti-mail-check",
        },
        {
          key: "customer_name",
          name: "Customer name",
          description: "Lookup from the linked customer.",
          type: "lookup",
          config: {
            relationFieldId: field("orders.customer"),
            targetFieldId: field("customers.name"),
          },
          icon: "ti ti-hierarchy",
        },
        {
          key: "customer_email",
          name: "Customer email",
          description: "Email address from the linked customer.",
          type: "lookup",
          config: {
            relationFieldId: field("orders.customer"),
            targetFieldId: field("customers.email"),
          },
          icon: "ti ti-mail",
        },
      ],
    },
    {
      key: "order_lines",
      name: "Order lines",
      description: "Itemized books and immutable sale prices for each order.",
      fields: [
        {
          key: "line_no",
          name: "Line number",
          description: "Generated identifier for this order line.",
          type: "id",
          config: { strategy: "sequence", prefix: "LINE-", padding: 5 },
          presentable: true,
          icon: "ti ti-list-numbers",
        },
        {
          key: "order",
          name: "Order",
          description: "Order this line belongs to.",
          type: "relation",
          required: true,
          icon: "ti ti-shopping-cart",
          config: { targetTableId: table("orders"), cardinality: "single" },
        },
        {
          key: "book",
          name: "Book",
          description: "Book sold on this line.",
          type: "relation",
          required: true,
          icon: "ti ti-book",
          config: { targetTableId: table("books"), cardinality: "single" },
        },
        {
          key: "quantity",
          name: "Quantity",
          description: "Number of copies sold.",
          type: "number",
          required: true,
          defaultValue: "1",
          config: { min: 1, integerOnly: true },
          icon: "ti ti-calculator",
        },
        {
          key: "unit_price",
          name: "Unit price",
          description: "Price captured when the order is placed; later catalog price changes do not alter the invoice.",
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
          key: "line_total",
          name: "Line total",
          description: "Quantity multiplied by the captured unit price.",
          type: "formula",
          config: {
            expression: formula(field("order_lines.quantity"), " * ", field("order_lines.unit_price")),
            format: { kind: "decimal", precision: 2, thousandsSeparator: true },
          },
          icon: "ti ti-calculator",
        },
        {
          key: "book_title",
          name: "Book title",
          description: "Lookup from the linked book.",
          type: "lookup",
          config: {
            relationFieldId: field("order_lines.book"),
            targetFieldId: field("books.title"),
          },
          icon: "ti ti-hierarchy",
        },
      ],
    },
  ],
  records: [
    {
      key: "authors.tolkien",
      table: "authors",
      values: {
        name: "J.R.R. Tolkien",
        birth_year: 1892,
        country: ["uk"],
        bio: "Philologist; coined Middle-earth.",
      },
    },
    {
      key: "authors.le_guin",
      table: "authors",
      values: {
        name: "Ursula K. Le Guin",
        birth_year: 1929,
        country: ["us"],
        bio: "SF/F that takes anthropology seriously.",
      },
    },
    {
      key: "authors.christie",
      table: "authors",
      values: {
        name: "Agatha Christie",
        birth_year: 1890,
        country: ["uk"],
        bio: "Best-selling mystery novelist.",
      },
    },
    {
      key: "genres.fantasy",
      table: "genres",
      values: { name: "Fantasy", description: "Worlds, magic, dragons." },
    },
    {
      key: "genres.scifi",
      table: "genres",
      values: {
        name: "Sci-Fi",
        description: "Speculative futures, hard tech.",
      },
    },
    {
      key: "genres.mystery",
      table: "genres",
      values: { name: "Mystery", description: "Whodunits and noir." },
    },
    {
      key: "books.hobbit",
      table: "books",
      values: {
        title: "The Hobbit",
        description: "A compact fantasy classic.",
        author: [record("authors.tolkien")],
        genre: [record("genres.fantasy")],
        isbn: "978-0-547-92822-7",
        pages: 310,
        price: "9.99",
        published: "1937-09-21",
        in_stock: true,
        tags: ["classic", "recommended"],
        score: 5,
      },
      files: [
        {
          field: "cover",
          filename: "the-hobbit-cover.svg",
          dataUrl: createMockCover({
            icon: "book",
            theme: "emerald",
            seed: "bookshop:the-hobbit",
            label: "The Hobbit",
          }).dataUrl,
        },
      ],
    },
    {
      key: "books.left_hand",
      table: "books",
      values: {
        title: "The Left Hand of Darkness",
        author: [record("authors.le_guin")],
        genre: [record("genres.scifi")],
        isbn: "978-0-441-47812-5",
        pages: 304,
        price: "11.99",
        published: "1969-03-01",
        in_stock: true,
        tags: ["recommended"],
        score: 5,
      },
      files: [
        {
          field: "cover",
          filename: "left-hand-of-darkness-cover.svg",
          dataUrl: createMockCover({
            icon: "book",
            theme: "violet",
            seed: "bookshop:left-hand",
            label: "The Left Hand of Darkness",
          }).dataUrl,
        },
      ],
    },
    {
      key: "books.abc",
      table: "books",
      values: {
        title: "The ABC Murders",
        author: [record("authors.christie")],
        genre: [record("genres.mystery")],
        isbn: "978-0-00-752752-6",
        pages: 220,
        price: "8.50",
        published: "1936-01-06",
        in_stock: false,
        tags: [],
        score: 4,
      },
      files: [
        {
          field: "cover",
          filename: "abc-murders-cover.svg",
          dataUrl: createMockCover({
            icon: "book",
            theme: "amber",
            seed: "bookshop:abc",
            label: "The ABC Murders",
          }).dataUrl,
        },
      ],
    },
    {
      key: "customers.alice",
      table: "customers",
      values: {
        name: "Alice Becker",
        email: "alice@example.test",
        phone: "+49 731 1234567",
        joined: "2025-03-12",
        notes: "Loves fantasy.",
        source: ["website"],
      },
    },
    {
      key: "customers.bob",
      table: "customers",
      values: {
        name: "Bob Schmidt",
        email: "bob@example.test",
        phone: "+49 731 7654321",
        joined: "2025-06-04",
        source: ["store"],
      },
    },
    {
      key: "orders.1",
      table: "orders",
      values: {
        customer: [record("customers.alice")],
        ordered_at: currentMonthDate(3),
        status: ["delivered"],
        invoice_ready: false,
        invoice_sent: true,
      },
    },
    {
      key: "orders.2",
      table: "orders",
      values: {
        customer: [record("customers.bob")],
        ordered_at: currentMonthDate(8),
        status: ["shipped"],
        invoice_ready: false,
        invoice_sent: true,
      },
    },
    {
      key: "orders.3",
      table: "orders",
      values: {
        customer: [record("customers.alice")],
        ordered_at: currentMonthDate(13),
        status: ["new"],
        invoice_ready: true,
        invoice_sent: false,
      },
    },
    {
      key: "order_lines.1_hobbit",
      table: "order_lines",
      values: {
        order: [record("orders.1")],
        book: [record("books.hobbit")],
        quantity: "2",
        unit_price: "9.99",
      },
    },
    {
      key: "order_lines.1_left_hand",
      table: "order_lines",
      values: {
        order: [record("orders.1")],
        book: [record("books.left_hand")],
        quantity: "1",
        unit_price: "11.99",
      },
    },
    {
      key: "order_lines.2_abc",
      table: "order_lines",
      values: {
        order: [record("orders.2")],
        book: [record("books.abc")],
        quantity: "1",
        unit_price: "8.50",
      },
    },
    {
      key: "order_lines.3_hobbit",
      table: "order_lines",
      values: {
        order: [record("orders.3")],
        book: [record("books.hobbit")],
        quantity: "1",
        unit_price: "9.99",
      },
    },
    {
      key: "order_lines.3_left_hand",
      table: "order_lines",
      values: {
        order: [record("orders.3")],
        book: [record("books.left_hand")],
        quantity: "3",
        unit_price: "11.99",
      },
    },
  ],
  views: [
    {
      key: "recent_books",
      table: "books",
      name: "Recent books",
      shared: true,
      source: formula(
        "from table ",
        table("books"),
        "\nselect ",
        field("books.title"),
        ", ",
        field("books.isbn"),
        ", ",
        field("books.author"),
        ", ",
        field("books.price"),
        ", ",
        field("books.published"),
        "\nsort ",
        field("books.published"),
        " desc\nlimit 20",
      ),
      ui: {
        columns: [
          { fieldId: field("books.title") },
          {
            fieldId: field("books.isbn"),
            format: { kind: "barcode", bcid: "isbn", showText: true },
          },
          { fieldId: field("books.author") },
          { fieldId: field("books.price") },
          { fieldId: field("books.published") },
        ],
        displayConfig: {
          mode: "cards",
          cards: {
            imageFieldId: field("books.cover"),
            fieldIds: [field("books.title"), field("books.author"), field("books.genre"), field("books.price"), field("books.published")],
          },
        },
      },
    },
    {
      key: "order_calendar",
      table: "orders",
      name: "Order calendar",
      shared: true,
      source: formula(
        "from table ",
        table("orders"),
        "\nselect ",
        field("orders.order_no"),
        ", ",
        field("orders.ordered_at"),
        ", ",
        field("orders.customer"),
        ", ",
        field("orders.status"),
        ", ",
        field("orders.invoice_ready"),
        ", ",
        field("orders.invoice_sent"),
        "\nsort ",
        field("orders.ordered_at"),
        " asc\nlimit 100",
      ),
      ui: {
        columns: [
          { fieldId: field("orders.order_no") },
          { fieldId: field("orders.ordered_at") },
          { fieldId: field("orders.customer") },
          { fieldId: field("orders.status") },
          { fieldId: field("orders.invoice_ready") },
          { fieldId: field("orders.invoice_sent") },
        ],
        displayConfig: {
          mode: "calendar",
          calendar: { dateFieldId: field("orders.ordered_at") },
        },
      },
    },
  ],
  forms: [
    {
      key: "add_book",
      table: "books",
      name: "Add book",
      config: {
        title: "Add book",
        submitLabel: "Add book",
        successMessage: "Book added.",
        fields: [
          {
            kind: "user_input",
            fieldId: field("books.title"),
            label: "Title",
            helpText: "Book title shown in catalog and order forms.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("books.author"),
            label: "Author",
            helpText: "Pick an existing author or create one inline.",
            required: true,
            inlineCreate: {
              enabled: true,
              fields: [
                {
                  fieldId: field("authors.name"),
                  label: "Author name",
                  helpText: "Full author name.",
                  required: true,
                },
                {
                  fieldId: field("authors.country"),
                  label: "Country",
                  helpText: "Optional author country.",
                },
                {
                  fieldId: field("authors.birth_year"),
                  label: "Birth year",
                  helpText: "Optional year of birth.",
                },
              ],
            },
          },
          {
            kind: "user_input",
            fieldId: field("books.isbn"),
            label: "ISBN",
            helpText: "Optional ISBN used for ordering and scans.",
          },
          {
            kind: "user_input",
            fieldId: field("books.genre"),
            label: "Genre",
            helpText: "Pick an existing genre or create one inline.",
            required: true,
            inlineCreate: {
              enabled: true,
              fields: [
                {
                  fieldId: field("genres.name"),
                  label: "Genre name",
                  helpText: "Short catalog genre, for example Fantasy.",
                  required: true,
                },
                {
                  fieldId: field("genres.description"),
                  label: "Description",
                  helpText: "Optional notes about this genre.",
                },
              ],
            },
          },
          {
            kind: "user_input",
            fieldId: field("books.price"),
            label: "Price",
            helpText: "Selling price for one copy.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("books.pages"),
            label: "Pages",
            helpText: "Number of pages.",
          },
          {
            kind: "user_input",
            fieldId: field("books.published"),
            label: "Published",
            helpText: "Original publication date.",
          },
          {
            kind: "user_input",
            fieldId: field("books.tags"),
            label: "Tags",
            helpText: "Optional catalog labels.",
          },
          {
            kind: "user_input",
            fieldId: field("books.score"),
            label: "Score",
            helpText: "Internal recommendation score from 0 to 5.",
          },
          {
            kind: "user_input",
            fieldId: field("books.description"),
            label: "Description",
            helpText: "Catalog notes or a short summary.",
          },
          { kind: "form_value", fieldId: field("books.in_stock"), value: true },
        ],
      },
    },
    {
      key: "new_order",
      table: "orders",
      name: "New order",
      config: {
        title: "New order",
        submitLabel: "Create order",
        successMessage: "Order created.",
        fields: [
          {
            kind: "user_input",
            fieldId: field("orders.customer"),
            label: "Customer",
            helpText: "Buyer for this order.",
            required: true,
            inlineCreate: {
              enabled: true,
              fields: [
                {
                  fieldId: field("customers.name"),
                  label: "Customer name",
                  helpText: "Full customer name.",
                  required: true,
                },
                {
                  fieldId: field("customers.email"),
                  label: "Email",
                  helpText: "Order contact address.",
                  required: true,
                },
                {
                  fieldId: field("customers.phone"),
                  label: "Phone",
                  helpText: "Optional phone number.",
                },
              ],
            },
          },
          {
            kind: "user_input",
            fieldId: field("orders.ordered_at"),
            label: "Ordered at",
            helpText: "Date the order was placed.",
            required: true,
          },
          {
            kind: "form_value",
            fieldId: field("orders.status"),
            value: ["new"],
          },
          {
            kind: "form_value",
            fieldId: field("orders.invoice_ready"),
            value: false,
          },
          {
            kind: "form_value",
            fieldId: field("orders.invoice_sent"),
            value: false,
          },
        ],
      },
    },
    {
      key: "add_order_line",
      table: "order_lines",
      name: "Add order line",
      config: {
        title: "Add order line",
        description: "Add a book and capture the sale price used on the invoice.",
        submitLabel: "Add line",
        successMessage: "Order line added.",
        fields: [
          {
            kind: "user_input",
            fieldId: field("order_lines.order"),
            label: "Order",
            helpText: "Order this item belongs to.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("order_lines.book"),
            label: "Book",
            helpText: "Book sold on this line.",
            required: true,
          },
          {
            kind: "user_input",
            fieldId: field("order_lines.quantity"),
            label: "Quantity",
            helpText: "Number of copies.",
            required: true,
            defaultValue: "1",
          },
          {
            kind: "user_input",
            fieldId: field("order_lines.unit_price"),
            label: "Unit price",
            helpText: "Capture the agreed sale price; the line total is calculated automatically.",
            required: true,
          },
        ],
      },
    },
  ],
  documentTemplates: [
    {
      key: "order_invoice",
      table: "orders",
      starterId: "invoice",
      name: "Order invoice",
      description: "Customer invoice with every line belonging to one order.",
      source: formula(
        "from table ",
        table("order_lines"),
        " as line\njoin table ",
        table("orders"),
        " as order on line.",
        field("order_lines.order"),
        " = order.id",
        "\nselect ",
        "order.",
        field("orders.order_no"),
        " as invoice_number, ",
        "order.",
        field("orders.customer_name"),
        " as recipient_name, ",
        "order.",
        field("orders.customer_email"),
        " as recipient_email, ",
        "line.",
        field("order_lines.book_title"),
        " as invoice_item, ",
        "line.",
        field("order_lines.quantity"),
        " as invoice_quantity, ",
        "line.",
        field("order_lines.unit_price"),
        " as invoice_unit_price, ",
        "line.",
        field("order_lines.line_total"),
        " as invoice_line_total, ",
        "order.",
        field("orders.ordered_at"),
        " as invoice_date, ",
        "order.",
        field("orders.status"),
        "\nwhere ",
        field("order_lines.order"),
        " = '{{ record.id }}'\nsort line.",
        field("order_lines.line_no"),
        " asc",
      ),
      enabled: true,
    },
  ],
  emailTemplates: [
    {
      key: "order_invoice_ready",
      name: "Order invoice ready",
      description: "Sends a private invoice link to the customer.",
      subject: "Invoice for order {{ data.orderNumber }}",
      html: `<main style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;max-width:640px;margin:0 auto;padding:32px;">
  <h1 style="font-size:24px;margin:0 0 16px;">Your invoice is ready</h1>
  <p>Hello {{ data.customerName | default: "there" }},</p>
  <p>We prepared the invoice for order <strong>{{ data.orderNumber }}</strong>.</p>
  <p style="margin:24px 0;"><a href="{{ data.invoice.url }}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;">Download invoice</a></p>
  <p style="color:#6b7280;font-size:14px;">This private link expires automatically.</p>
</main>`,
      sampleData: {
        customerName: "Ada Lovelace",
        orderNumber: "ORD-2026-0042",
        invoice: {
          url: "https://cloud.example.org/share/grids/documents/example",
        },
      },
      enabled: true,
    },
  ],
  workflows: [
    {
      key: "send_order_invoice",
      name: "Send order invoice",
      description: "Generates an invoice, creates a private link, and emails it to the customer.",
      source: `inputs:
  order:
    type: record
    table: Orders
    label: Order
    required: true
steps:
  - if:
      equals:
        - \${{ inputs.order.Invoice sent }}
        - true
    then:
      - fail:
          message: This invoice was already sent. Open the generated documents to download or share it again.
  - if:
      not:
        exists: inputs.order.Customer email
    then:
      - fail:
          message: Add a customer email address before sending the invoice.
  - if:
      endsWith:
        - \${{ inputs.order.Customer email }}
        - .test
    then:
      - fail:
          message: Replace the sample customer email before sending a real invoice.
  - if:
      notEquals:
        - \${{ inputs.order.Ready to invoice }}
        - true
    then:
      - fail:
          message: Add every order line, then mark the order as ready to invoice.
  - generateDocument:
      template: Order invoice
      record: inputs.order
      saveAs: invoicePdf
  - createDocumentLink:
      document: invoicePdf
      expiresIn: 30d
      saveAs: invoiceLink
  - sendEmail:
      template: Order invoice ready
      to:
        - email: \${{ inputs.order.Customer email }}
      data:
        invoice: \${{ invoiceLink }}
        orderNumber: \${{ inputs.order.Order number }}
        customerName: \${{ inputs.order.Customer name }}
  - updateRecord:
      record: inputs.order
      set:
        Ready to invoice: false
        Invoice sent: true
  - succeed:
      message: "Invoice \${{ inputs.order.Order number }} sent to \${{ inputs.order.Customer email }}."`,
      enabled: true,
    },
  ],
  workflowLaunchers: [
    {
      key: "send_order_invoice_custom_app",
      workflow: "send_order_invoice",
      name: "Choose order to send invoice",
      config: { kind: "customApp", inputMode: "prompt" },
      enabled: true,
    },
  ],
  customApps: [
    {
      key: "sales",
      name: "Bookshop overview",
      description: "Revenue, fulfillment, catalog maintenance, and recent books.",
      rows: [
        {
          id: "r_stats",
          columns: [
            {
              id: "w_orders",
              type: "metrics",
              title: "Orders",
              valueFormat: { style: "integer" },
              span: 4,
              source: {
                kind: "gql",
                query: formula("from table ", table("orders"), "\naggregate count(*) as order_count"),
              },
            },
            {
              id: "w_revenue",
              type: "metrics",
              title: "Total revenue",
              valueFormat: {
                style: "number",
                decimalPlaces: 2,
                unit: "EUR",
                unitPosition: "suffix",
              },
              span: 4,
              source: {
                kind: "gql",
                query: formula(
                  "from table ",
                  table("order_lines"),
                  "\naggregate sum(formula(",
                  field("order_lines.quantity"),
                  " * ",
                  field("order_lines.unit_price"),
                  ")) as total_revenue",
                ),
              },
            },
            {
              id: "w_books",
              type: "metrics",
              title: "Books",
              valueFormat: { style: "integer" },
              span: 4,
              source: {
                kind: "gql",
                query: formula("from table ", table("books"), "\naggregate count(*) as book_count"),
              },
            },
          ],
        },
        {
          id: "r_main",
          columns: [
            {
              id: "w_chart",
              type: "chart",
              title: "Monthly revenue",
              chartType: "line",
              source: {
                kind: "gql",
                query: formula(
                  "from table ",
                  table("order_lines"),
                  " as line\njoin table ",
                  table("orders"),
                  " as order on line.",
                  field("order_lines.order"),
                  " = order.id\ngroup by order.",
                  field("orders.ordered_at"),
                  " by month\naggregate sum(formula(",
                  "line.",
                  field("order_lines.quantity"),
                  " * line.",
                  field("order_lines.unit_price"),
                  ")) as monthly_revenue, count(*) as order_line_count\nsort ",
                  "order.",
                  field("orders.ordered_at"),
                  " asc",
                ),
              },
              valueFormat: {
                style: "number",
                decimalPlaces: 2,
                unit: "EUR",
                unitPosition: "suffix",
              },
              span: 6,
            },
            {
              id: "w_new_order",
              type: "form",
              title: "New order",
              formId: form("new_order"),
              span: 3,
            },
            {
              id: "w_add_order_line",
              type: "form",
              title: "Add order line",
              formId: form("add_order_line"),
              span: 3,
            },
          ],
        },
        {
          id: "r_views",
          columns: [
            {
              id: "w_add_book",
              type: "form",
              title: "Add book",
              formId: form("add_book"),
              span: 6,
            },
            {
              id: "w_recent",
              type: "records",
              searchable: true,
              pageSize: 25,
              title: "Recent books",
              source: { kind: "view", viewId: view("recent_books") },
              span: 6,
            },
          ],
        },
        {
          id: "r_fulfillment",
          columns: [
            {
              id: "w_revenue_by_customer",
              type: "chart",
              title: "Revenue by customer",
              subtitle: "Joined directly from orders and customers",
              chartType: "bar",
              source: {
                kind: "gql",
                query: formula(
                  "from table ",
                  table("order_lines"),
                  " as line\njoin table ",
                  table("orders"),
                  " as order on line.",
                  field("order_lines.order"),
                  " = order.id\njoin table ",
                  table("customers"),
                  " as customer on order.",
                  field("orders.customer"),
                  " = customer.id\ngroup by customer.",
                  field("customers.name"),
                  "\naggregate sum(formula(",
                  "line.",
                  field("order_lines.quantity"),
                  " * line.",
                  field("order_lines.unit_price"),
                  ")) as customer_revenue\nhaving customer_revenue > 0\nsort customer_revenue desc nulls last\nlimit 8",
                ),
              },
              valueFormat: {
                style: "number",
                decimalPlaces: 2,
                unit: "EUR",
                unitPosition: "suffix",
              },
              span: 7,
            },
            {
              id: "w_send_invoice",
              type: "actions",
              title: "Send an invoice",
              buttonLabel: "Choose order",
              launcherId: launcher("send_order_invoice_custom_app"),
              span: 5,
            },
          ],
        },
      ],
    },
  ],
};
