# Spreadsheet acceptance

- Open the final workbook or parse the delivered tabular file. Confirm sheet names, row and column counts, types, units, date systems, currencies, percentages, and required formatting.
- Recalculate formulas and check for formula errors, broken references, inconsistent ranges, hidden accidental values, and stale cached results.
- Independently reconcile totals, subtotals, joins, filters, deduplication, and representative source-to-output rows. Use invariants such as row counts and control totals instead of trusting the same formula twice.
- Inspect every delivered sheet visually when formatting, charts, print layout, merged cells, widths, or frozen panes matter. Check chart labels and values against their source ranges.
- Correct defects and repeat recalculation, reconciliation, and affected visual inspection.

Acceptance requires correct values and formulas, preserved source data, and usable final formatting. State unresolved source-data quality issues separately from implementation defects.
