---
name: spreadsheet-work
description: Use for analyzing tabular data, cleaning or joining datasets, creating formulas and summaries, producing CSV or spreadsheet outputs, or checking an existing workbook for correctness.
---

# Spreadsheet work

Inspect the source columns, types, units, missing values, and row count before transforming data. Keep raw inputs separate from derived outputs. Make assumptions explicit, especially for dates, currencies, percentages, duplicate keys, and blank values.

Use a spreadsheet-specific tool when the runtime provides one. Otherwise use simple filesystem and shell operations for CSV or TSV, and choose common installed libraries only when they materially reduce code. Do not edit XLSX as text or claim workbook formatting was verified without rendering or opening it through a suitable tool.

Validate totals, formulas, joins, and output row counts with independent checks. Deliver a usable file plus a concise note naming the source, transformations, validation performed, and any unresolved data-quality issue.
