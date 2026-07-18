---
id: grids-formulas
title: Formulas
icon: ti ti-function
description: Formula syntax and the complete function catalog.
order: 126
---
Formulas calculate values from fields in one record. The same expression model is used by formula fields, computed columns, query predicates, and query output, so one reference is enough for humans, CLI workflows, and future agent context.

### Where formulas run

- **Formula fields:** A saved table field that recalculates when records are read and can be shown in views, cards, detail panels, dashboards, and templates.
- **Computed columns:** A temporary output column for analysis. It does not change the table schema unless the user saves a real field.
- **GQL predicates:** A server-side condition used by where and having. Use formulas here to filter rows by derived values.
- **GQL output:** A calculated result column written as formula(expression) as alias.

### Expression rules

- **Fields:** Reference fields by name. Quote names with spaces or punctuation: `"Unit price"`.
- **Text values:** Use single quotes for text values: `'Open'`. Double quotes mean a field name.
- **Empty values:** Empty input stays empty unless the expression handles it. Use IFEMPTY for expected fallbacks.
- **Errors:** Formula errors render as an error value. Use IFERROR for expected divide-by-zero, missing-value, or conversion cases.

### Common formulas

**Line total**

```text
price * quantity
```

**Gross amount**

```text
"Unit price" * quantity * 1.19
```

**Fallback text**

```text
IFEMPTY(notes, 'No notes')
```

**Conditional label**

```text
IF(inStock, 'Available', 'Out of stock')
```

**Days until due**

```text
DATEDIFF(TODAY(), dueDate, 'days')
```

**Safe division**

```text
IFERROR(total / quantity, 0)
```

### Full function reference

| Group     | Function                           | What it does                                                             | Returns |      |
| --------- | ---------------------------------- | ------------------------------------------------------------------------ | ------- | ---- |
| Aggregate | SUM(value, ...)                    | Add numeric values.                                                      | number  | Copy |
| Aggregate | AVG(value, ...)                    | Average numeric values.                                                  | number  | Copy |
| Aggregate | MEAN(value, ...)                   | Alias for AVG.                                                           | number  | Copy |
| Aggregate | COUNT(value, ...)                  | Count non-empty values.                                                  | number  | Copy |
| Aggregate | MIN(value, ...)                    | Smallest numeric value.                                                  | number  | Copy |
| Aggregate | MAX(value, ...)                    | Largest numeric value.                                                   | number  | Copy |
| Aggregate | MEDIAN(value, ...)                 | Middle numeric value.                                                    | number  | Copy |
| Number    | ABS(number)                        | Absolute value.                                                          | number  | Copy |
| Number    | ROUND(number, digits?)             | Round a number.                                                          | number  | Copy |
| Number    | FLOOR(number)                      | Round down.                                                              | number  | Copy |
| Number    | CEIL(number)                       | Round up.                                                                | number  | Copy |
| Number    | SQRT(number)                       | Square root.                                                             | number  | Copy |
| Number    | POW(base, exponent)                | Power.                                                                   | number  | Copy |
| Number    | MOD(a, b)                          | Remainder.                                                               | number  | Copy |
| Number    | PERCENT(part, total)               | Part as percent of total.                                                | number  | Copy |
| Logic     | IF(condition, then, else)          | Choose by condition.                                                     | any     | Copy |
| Logic     | IFEMPTY(value, fallback)           | Fallback for empty values.                                               | any     | Copy |
| Logic     | IFERROR(value, fallback)           | Fallback for formula errors.                                             | any     | Copy |
| Logic     | AND(value, ...)                    | All values are truthy. In GQL where/having, prefer the \`and\` operator. | boolean | Copy |
| Logic     | OR(value, ...)                     | Any value is truthy. In GQL where/having, prefer the \`or\` operator.    | boolean | Copy |
| Logic     | NOT(value)                         | Invert truthiness. In GQL where/having, prefer the \`not\` operator.     | boolean | Copy |
| Logic     | ISBLANK(value)                     | True when empty.                                                         | boolean | Copy |
| Text      | CONTAINS(text, search)             | Substring match.                                                         | boolean | Copy |
| Text      | STARTSWITH(text, prefix)           | True when text starts with prefix.                                       | boolean | Copy |
| Text      | ENDSWITH(text, suffix)             | True when text ends with suffix.                                         | boolean | Copy |
| Text      | ICONTAINS(text, search)            | Case-insensitive substring match.                                        | boolean | Copy |
| Text      | ISTARTSWITH(text, prefix)          | Case-insensitive starts-with match.                                      | boolean | Copy |
| Text      | IENDSWITH(text, suffix)            | Case-insensitive ends-with match.                                        | boolean | Copy |
| Text      | CONCAT(value, ...)                 | Join values as text.                                                     | text    | Copy |
| Text      | LEN(text)                          | Text length.                                                             | number  | Copy |
| Text      | LOWER(text)                        | Lowercase text.                                                          | text    | Copy |
| Text      | UPPER(text)                        | Uppercase text.                                                          | text    | Copy |
| Text      | TRIM(text)                         | Trim whitespace.                                                         | text    | Copy |
| Text      | LEFT(text, n)                      | First n characters.                                                      | text    | Copy |
| Text      | RIGHT(text, n)                     | Last n characters.                                                       | text    | Copy |
| Text      | SUBSTRING(text, start, length)     | Text slice with 0-based start.                                           | text    | Copy |
| Text      | REPLACE(text, search, replacement) | Replace all matches.                                                     | text    | Copy |
| Date      | TODAY()                            | Current date.                                                            | date    | Copy |
| Date      | NOW()                              | Current date and time.                                                   | date    | Copy |
| Date      | YEAR(date)                         | Year number.                                                             | number  | Copy |
| Date      | MONTH(date)                        | Month number.                                                            | number  | Copy |
| Date      | DAY(date)                          | Day number.                                                              | number  | Copy |
| Date      | DATEADD(date, count, unit?)        | Add time to a date; the unit defaults to days.                           | date    | Copy |
| Date      | DATEDIFF(from, to, unit?)          | Difference between dates; the unit defaults to days.                     | number  | Copy |

:::note For scripts, CLI, and agents
Treat field names, formulas, GQL, templates, and workflows as public text surfaces. Prefer exact names from the reference or current base inventory, keep aliases readable, and quote values deliberately so generated changes are reviewable.
:::
