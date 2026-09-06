# Agent Note: Desktop window drag and path attachments

Status: implemented

English | [中文](2026-09-03-desktop-window-drag-and-path-paste.zh.md)

## Problem

The macOS Desktop window hides the native title bar, but its replacement header had no drag region. The composer also accepted images from the browser clipboard path while files and folders copied from Finder could not enter the existing attachment rail.

## Decision

The fixed top strip is an Electron drag region. It contains no application controls, so the implementation does not add pointer tracking or a custom window-motion IPC.

The context-isolated preload observes paste gestures only while the enabled composer textarea owns the event. It resolves native `File` objects with Electron's supported path API and prevents the existing text/image handler only when the clipboard carries a file URL, filesystem item, or image. Plain text keeps the existing composer transaction. The captured selection and input revision bind each staged item to that exact draft location; a changed draft rejects the late insertion and releases the staged item instead of placing it elsewhere.

Desktop Main validates the typed paste request and reads native file-URL or PNG clipboard data when Chromium does not expose a path. Existing files and folders remain at their original absolute paths and become ACP resource links carrying their media type and byte size; no recursive copy or media decode occurs. A pathless bitmap is the sole case written below the Session input directory. Each staged item becomes a structured inline composer reference with its file or folder icon and name, so it can appear between ordinary words and be repeated. The input reserves equal capsule ends around the icon and label, keeps the capsule on one visual line, moves the caret across the complete occurrence, and deletes that occurrence in one edit. The reference serializer keeps the display name with its opaque attachment marker; Skill references use a structured Skill marker instead of reducing to slash-prefixed text. The Main process replaces each attachment marker with its ACP block in that exact order. The immediate sent-message projection uses those same ordered parts, so capsules survive a Runtime text normalization; replayed resource links and Skills use the same compact capsule rendering.

Desktop prompt submission separates local acceptance from remote completion. Once the Main-process IPC request is accepted, the renderer commits the draft while the ACP turn continues in the background. The composer remains editable for the next draft, and its inline activity copy is hidden because the transcript already owns live turn and tool progress. A background prompt failure remains a visible composer error; an IPC admission failure retains the draft because acceptance never occurred. The sticky composer seat paints a background-color mask across the bottom and side clearance with fixed transparent-to-solid gradients, so transcript content does not compete with the active input surface.

## Alternatives considered

A custom pointer-driven window drag loop would duplicate Electron's native window behavior and require extra renderer-to-Main state, so the header uses the platform drag region. Copying every pasted path into Session storage would make folder attachment recursive and expensive while changing the user's source identity, so existing filesystem items remain path references. Routing attachment inspection through Computer Use would add unrelated screen-capture permission and lose structured filesystem evidence, so attached resources use filesystem and format-specific tools.

## Consequences

Finder copy and composer paste can attach arbitrary file formats and folders without loading their contents into the model request. Users can place the same reference beside the words it qualifies, such as an image before a target HTML file, and the Agent receives the corresponding resource block at that point in the prompt. The Agent receives an explicit path and media type; `list_directory` supplies bounded non-recursive directory evidence and a provider-resolved path for every child, while file-format tools inspect supported files. Follow-up tools use that path unchanged so significant filename whitespace survives. Deleting an inline reference before sending removes the staging identity from the prompt; a source path can become stale or inaccessible before submission, in which case the existing fail-loud prompt behavior applies.
