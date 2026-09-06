---
name: document-work
description: Use for drafting, editing, restructuring, summarizing, or reviewing reports, proposals, specifications, meeting notes, Markdown, HTML, or office documents. For a new document with no explicit format or technical stack, default to standalone HTML; explicit formats or stacks and existing file formats always take precedence.
---

# Document work

Confirm the document's audience and purpose, then resolve the output format in this order:

1. Use an explicitly requested output format, such as DOCX.
2. Use an explicitly requested technical stack or framework, such as React.
3. Treat a format-specific artifact such as an Excel spreadsheet as an explicit request for its corresponding format, such as XLSX.
4. When editing an existing file, preserve its format unless the user explicitly requests conversion.
5. Only when none of the preceding rules applies, create the new document as one standalone `.html` file with CSS in `<style>` and any required JavaScript in `<script>`.

Do not silently substitute another format when the requested format cannot be created or verified; report the limitation. Default standalone HTML requires no build step, package manager, framework, separate stylesheet, separate script file, or external runtime dependency. Include JavaScript only when the document needs interaction.

For an existing document, inspect it before editing and retain content outside the requested scope. Preserve established terminology and structure unless the user asks for a rewrite. For a new document, build the shortest structure that makes the result easy to use.

Review the completed artifact for missing sections, broken links, inconsistent headings, placeholder text, and obvious layout problems. Return the final file path and a short description of what changed.
