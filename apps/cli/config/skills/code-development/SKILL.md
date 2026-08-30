---
name: code-development
description: Use for implementing, debugging, refactoring, or reviewing software; inspecting a repository; running builds and tests; or answering questions that require evidence from source code. Works with filesystem, search, shell, and LSP tools when the active runtime provides them.
---

# Code development

Inspect the repository before changing it. Read the nearest project instructions and the files that own the behavior. Prefer existing abstractions and keep the change limited to the user's request.

Use fast text and file search for ordinary navigation. Use LSP for definitions, references, implementations, and hover when it is available and textual matches are ambiguous. Do not require LSP: fall back to search and direct source inspection when the runtime has no configured language server.

Preserve unrelated local changes. Make edits through the filesystem tools, then run the smallest relevant typecheck, test, lint, or build that covers the changed surface. Diagnose a failing check before widening the change. Report the files changed, the checks actually run, and any remaining limitation.
