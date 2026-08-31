# Agent Note: Desktop Skills, attachments, and ordinary artifacts

Status: implemented

English | [中文](2026-08-30-desktop-skills-attachments-and-artifacts.zh.md)

## Problem

The Desktop product already discovers Skills and can exchange ACP text, but users cannot import or select Skills, attach local files, or retrieve files created by a task. Exposing generic filesystem IPC to solve those gaps would give the sandboxed Renderer unnecessary authority and create a second file protocol beside ACP.

## Decision

The Desktop main process exposes narrow operations for Skill import and removal, attachment staging, and artifact export. User Skills are validated and copied below `~/.dsh/skills`; project and bundled Skills remain read-only. The composer launcher presents attachment upload and a hover submenu for the effective Skills catalog. Both menu panels have an opaque raised background with a subtle edge shadow, and their hit areas overlap so the pointer can enter the submenu without closing it. A selected Skill is an input-trigger reference whose model form remains `/skill-name`; the composer and sent message render the reference as the same neutral capsule with spacing between its icon and label.

Selected attachments are copied into the Session artifact area before their opaque ids reach the prompt call. Images become durable ACP image blocks through the Runtime's local attachment store and reach the configured vision-capable OpenAI-compatible model as image input; ordinary supported files become ACP resource links. The Desktop message adapter projects the durable bracketed resource-link text as a file capsule and omits its local URI from the visible transcript. The Renderer never receives file bytes or arbitrary read access. Selecting either an attachment or a Skill never writes a canned task prompt into the draft.

For each prompt, the main process compares supported ordinary files in the Workspace before and after the turn. Created or changed files are copied to `<workspace>/.dsh/artifacts/<session>/turn-NNNN/` and recorded in `manifest.json`. The Desktop adapter projects those copies as successful edit locations, so the existing deliverables accumulator places them after the closing response. Desktop-only controls add native Save As and ZIP export.

## Alternatives considered

**Expose generic filesystem IPC.** This would make import, attachment, and export code shorter, but browser code could read or write arbitrary user files. Fixed operations keep path resolution, validation, and native user confirmation in the main process.

**Build a second Skills and artifact subsystem in Desktop.** This would isolate the preview application but duplicate Skill invocation and produced-file rules. Reusing the Runtime registry, ACP content blocks, input-trigger pipeline, and deliverables projection keeps one behavior across product entry points.

## Verification

Focused tests exercise Skill source precedence and removal, ordinary attachment staging and ACP projection, changed-file capture, manifest storage, and ZIP exclusion of prompt inputs. The Desktop build compiles the main process, preload, shared product client, and production Renderer bundle together.

## Consequences

- The new UI shares the Skills registry, input menu, ACP prompt path, and deliverables projection instead of duplicating them.
- Renderer authority remains a fixed set of user-mediated operations.
- Attachment and captured artifact files are limited to images and ordinary text/code/Markdown/HTML/JSON/CSV-family formats, with bounded file size and scan count.
- DOCX, XLSX, PDF, and PPTX generation remains a separate capability.
