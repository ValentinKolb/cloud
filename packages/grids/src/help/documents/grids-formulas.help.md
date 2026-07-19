---
id: grids-formulas
title: Formulas
icon: ti ti-function
description: Calculate values from fields with one shared expression language.
order: 126
---
Formulas calculate a value from fields in one record. Use them for totals, labels, date differences, conditions, and other results that should follow the saved inputs automatically.

Create a **Formula field** when the result belongs on every record. Add a **Computed column** when the calculation is only needed in one query. In GQL, the same expression language can filter records or create an output column.

### Where formulas run

- **Formula fields** recalculate when records are read and can appear in views, cards, detail panels, dashboards, and documents.
- **Computed columns** are temporary query output and do not change the table schema.
- **GQL conditions** use an expression inside `where` or `having`.
- **GQL output** uses `formula(expression) as alias`.

Formula evaluation and GQL compilation happen on the server. A formula does not depend on the browser having loaded every record.

### Expression rules

- **Fields:** Reference fields by name. Quote names with spaces or punctuation: `"Unit price"`.
- **Text values:** Use single quotes for text values: `'Open'`. Double quotes mean a field name.
- **Empty values:** Empty input stays empty unless the expression handles it. Use IFEMPTY for expected fallbacks.
- **Errors:** Formula errors render as an error value. Use IFERROR for expected divide-by-zero, missing-value, or conversion cases.

Build a formula from a representative record and check empty, zero, and boundary values. If a field changes type or is removed, update dependent formulas before relying on their output.

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

| Group     | Function                           | What it does                                                             | Returns |
| --------- | ---------------------------------- | ------------------------------------------------------------------------ | ------- |
| Aggregate | SUM(value, ...)                    | Add numeric values.                                                      | number  |
| Aggregate | AVG(value, ...)                    | Average numeric values.                                                  | number  |
| Aggregate | MEAN(value, ...)                   | Alias for AVG.                                                           | number  |
| Aggregate | COUNT(value, ...)                  | Count non-empty values.                                                  | number  |
| Aggregate | MIN(value, ...)                    | Smallest numeric value.                                                  | number  |
| Aggregate | MAX(value, ...)                    | Largest numeric value.                                                   | number  |
| Aggregate | MEDIAN(value, ...)                 | Middle numeric value.                                                    | number  |
| Number    | ABS(number)                        | Absolute value.                                                          | number  |
| Number    | ROUND(number, digits?)             | Round a number.                                                          | number  |
| Number    | FLOOR(number)                      | Round down.                                                              | number  |
| Number    | CEIL(number)                       | Round up.                                                                | number  |
| Number    | SQRT(number)                       | Square root.                                                             | number  |
| Number    | POW(base, exponent)                | Power.                                                                   | number  |
| Number    | MOD(a, b)                          | Remainder.                                                               | number  |
| Number    | PERCENT(part, total)               | Part as percent of total.                                                | number  |
| Logic     | IF(condition, then, else)          | Choose by condition.                                                     | any     |
| Logic     | IFEMPTY(value, fallback)           | Fallback for empty values.                                               | any     |
| Logic     | IFERROR(value, fallback)           | Fallback for formula errors.                                             | any     |
| Logic     | AND(value, ...)                    | All values are truthy. In GQL where/having, prefer the \`and\` operator. | boolean |
| Logic     | OR(value, ...)                     | Any values are truthy. In GQL where/having, prefer the \`or\` operator.  | boolean |
| Logic     | NOT(value)                         | Invert truthiness. In GQL where/having, prefer the \`not\` operator.     | boolean |
| Logic     | ISBLANK(value)                     | True when empty.                                                         | boolean |
| Text      | CONTAINS(text, search)             | Substring match.                                                         | boolean |
| Text      | STARTSWITH(text, prefix)           | True when text starts with prefix.                                       | boolean |
| Text      | ENDSWITH(text, suffix)             | True when text ends with suffix.                                         | boolean |
| Text      | ICONTAINS(text, search)            | Case-insensitive substring match.                                        | boolean |
| Text      | ISTARTSWITH(text, prefix)          | Case-insensitive starts-with match.                                      | boolean |
| Text      | IENDSWITH(text, suffix)            | Case-insensitive ends-with match.                                        | boolean |
| Text      | CONCAT(value, ...)                 | Join values as text.                                                     | text    |
| Text      | LEN(text)                          | Text length.                                                             | number  |
| Text      | LOWER(text)                        | Lowercase text.                                                          | text    |
| Text      | UPPER(text)                        | Uppercase text.                                                          | text    |
| Text      | TRIM(text)                         | Trim whitespace.                                                         | text    |
| Text      | LEFT(text, n)                      | First n characters.                                                      | text    |
| Text      | RIGHT(text, n)                     | Last n characters.                                                       | text    |
| Text      | SUBSTRING(text, start, length)     | Text slice with 0-based start.                                           | text    |
| Text      | REPLACE(text, search, replacement) | Replace all matches.                                                     | text    |
| Date      | TODAY()                            | Current date.                                                            | date    |
| Date      | NOW()                              | Current date and time.                                                   | date    |
| Date      | YEAR(date)                         | Year number.                                                             | number  |
| Date      | MONTH(date)                        | Month number.                                                            | number  |
| Date      | DAY(date)                          | Day number.                                                              | number  |
| Date      | DATEADD(date, count, unit?)        | Add time to a date; the unit defaults to days.                           | date    |
| Date      | DATEDIFF(from, to, unit?)          | Difference between dates; the unit defaults to days.                     | number  |

`DATEADD` accepts days, hours, minutes, months, and years. `DATEDIFF` accepts days, hours, minutes, and seconds. The result of `DATEDIFF(from, to, unit)` is `to - from`.

:::note Formula fields do not store a second value
They are calculated from the current record when read. Change the source fields when the result is wrong rather than editing the displayed formula result.
:::
