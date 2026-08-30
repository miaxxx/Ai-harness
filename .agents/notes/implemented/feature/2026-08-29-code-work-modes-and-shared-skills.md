# Agent Note: Code and Work modes share bundled task skills

Status: implemented

English | [中文](2026-08-29-code-work-modes-and-shared-skills.zh.md)

## Problem

The shipped presets are centered on coding compositions, while general research, document, and spreadsheet requests have no product-owned guidance. Copying WorkBuddy skills directly would also import assumptions about proprietary tools and connectors that this runtime does not provide. A separate intent router would duplicate the skill catalog's existing description-based selection and add another service to maintain.

## Decision

The product exposes Code and Work as the two primary task presets. Code keeps Code Mode tool presentation and the full development tool composition. Work uses native tool presentation and a compact composition of web search, filesystem, shell, jobs, compaction, goals, questions, todos, and the skill loader. New installations default to Code; existing user settings continue to override the composition default.

Both presets mount the same trusted bundled root at `apps/cli/config/skills/`. It contains four dependency-light skills: `code-development`, `web-research`, `document-work`, and `spreadsheet-work`. Their descriptions select them from the user's task, so there is no mode router and no requirement that every turn load every skill.

Desktop uses an ACP Runtime instead of the Web preset host. Its supervisor sets `DSH_DESKTOP_CODE_WORK_ENABLED` and the packaged bundled-skill path, and the ACP composition conditionally mounts the same skill catalog and its loader plus DeepSeek-backed web search. The packaging step copies the shared directory into the standalone Runtime. Generic ACP and snapshot runs do not set the product flag, so their persona and tool catalog remain unchanged.

The same Desktop product flag mounts the persisted goal domain, its same-session continuation driver, and model-facing goal tools. Routine requests run without a goal. A substantial request with at least three independently verifiable work items uses one goal and a three-to-seven-item `todo_write` list; the parent agent continues until it verifies the complete objective, reports a concrete blocker, or the user cancels. Delegation is limited by prompt policy to two independent children at once, while the existing subagent depth limit prevents recursive delegation. ACP plan updates feed the Desktop's existing Todo panel instead of introducing a second task store.

The skills use capabilities already supplied by the active preset. Document and spreadsheet guidance prefers a dedicated tool when one exists and falls back to portable Markdown, HTML, CSV, or TSV rather than depending on an office SDK. Code guidance uses LSP when the deployment has configured a language server and otherwise falls back to search and source inspection; the shipped app does not install a language server merely to make the tool name appear.

## Alternatives considered

**Copy WorkBuddy's skills and tool vocabulary verbatim.** Those instructions name private tools, connectors, and artifact services that are not part of this runtime. The result would advertise workflows that cannot complete, so only portable workflow guidance is retained.

**Add an intent-classification plugin between the user and the skill registry.** Skill descriptions already provide request-sensitive discovery. A second classifier would create routing state and failure modes without adding a capability.

**Use plan mode or a dynamic workflow for every substantial Desktop task.** Plan mode stops for review before execution, while the product requirement is to plan and execute in one user turn. Dynamic workflows add a script-authored orchestration layer for work that the existing same-session goal, todo, and subagent tools already cover.

**Install language servers and office libraries with the presets.** That would turn a lightweight composition change into platform-specific dependency management. LSP and richer office formats remain capability-driven: use them when the host supplies them, and degrade explicitly when it does not.

## Consequences

Code and Work share one maintained workflow catalog while retaining tool presentation suited to their tasks. The Work preset is smaller than Standard because it does not mount delegation, workflow, Ralph, or plan-mode services that are unrelated to its core use. The system skills can be updated in one location and travel with both the CLI package and Desktop Runtime. Desktop web search still requires a DeepSeek search credential even when its primary chat model uses another OpenAI-compatible provider. Rich DOCX, XLSX, PDF, and LSP behavior still depends on installed providers; the skills state that limitation instead of presenting unavailable functionality.

Desktop complex tasks consume additional model rounds and remain dependent on the model reporting accurate goal and todo state. The product gains durable continuation and visible progress without a separate scheduler, planner database, or team coordinator. Users retain cancellation authority, and the goal driver does not retry provider or persistence failures automatically.
