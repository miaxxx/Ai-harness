---
name: delivery-verification
description: Use whenever a task creates or changes deliverable artifacts—code, web UI, documents, PDFs, presentations, spreadsheets, images, or sourced research—to run mandatory final-state acceptance and repair before claiming completion. Do not use for answer-only conversation with no artifact or externally verified research result.
---

# Delivery verification

Verify the finished deliverables, not the work narrative. Preserve the user's requested scope and use the request plus applicable project instructions as the acceptance criteria.

## Route by deliverable

Read only the references for the deliverables this task actually produces. Use every applicable reference for a mixed deliverable.

- Code or configuration: [references/code.md](references/code.md)
- Browser UI, website, or interactive page: [references/web-ui.md](references/web-ui.md)
- Markdown, HTML, DOCX, or other document: [references/documents.md](references/documents.md)
- PDF: [references/pdf.md](references/pdf.md)
- Presentation or slide deck: [references/presentations.md](references/presentations.md)
- Spreadsheet, CSV, or tabular workbook: [references/spreadsheets.md](references/spreadsheets.md)
- Generated or edited image and other static visual: [references/images.md](references/images.md)
- Web research or sourced factual report: [references/research.md](references/research.md)

## Mandatory acceptance loop

1. Turn the requested outcome, constraints, and output format into observable checks. Include applicable project-defined checks. Do not add unrelated quality goals.
2. Inspect the final artifact itself. Use deterministic validation for structure and behavior. Render or open visual output and examine the actual result.
3. Run acceptance after the last meaningful edit. Evidence from before that edit is stale for the affected surface.
4. If any check fails, fix the defect and rerun that check plus any check the fix can affect. Repeat until all checks pass or a concrete external blocker prevents progress.
5. Before replying, confirm that every requested deliverable exists in its final location, contains no placeholders or accidental debug residue, and is usable in the requested format.

Report only checks actually performed. If a required verifier is unavailable, try another suitable inspection path; if none exists, state the unverified condition plainly and do not describe it as passed.
