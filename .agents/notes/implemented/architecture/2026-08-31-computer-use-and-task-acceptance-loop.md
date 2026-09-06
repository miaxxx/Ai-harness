# Agent Note: Computer Use and task acceptance loop

Status: implemented

English | [中文](2026-08-31-computer-use-and-task-acceptance-loop.zh.md)

## Problem

The initial Desktop Computer capability selected one Provider globally, addressed only applications, exposed a shallow action vocabulary, and allowed model workflows to continue from stale element identifiers. Desktop capture and browser-tab control could not compose naturally with native application control. Completion guidance also emphasized produced artifacts without stating proportionate evidence for read-only investigation, code changes, or external and UI mutations. Moving those concerns into `agent-loop` would couple core scheduling to domain-specific observation and acceptance rules.

## Decision

Computer control uses one target-aware capability seam and one model-facing `computer` tool. `ComputerTarget` distinguishes native applications, browser tabs, and the complete Desktop. `ComputerRuntime` routes `listTargets`, `observe`, and `perform` to Providers by target kind; a configured Provider id breaks only otherwise ambiguous ties. Browser CDP and macOS Providers can therefore coexist in one assembled session.

Observations request accessibility state, visual state, or both. Accessibility elements are bounded and carry observation-scoped ids. The tool caches only the latest accessibility observation for each Agent and target, excludes image bytes from that cache, expires entries after a bounded interval, and disposes its timers with the plugin. Element actions accept only exact ids present in that latest observation. An approved mutation invalidates the cached state before Provider dispatch, including when dispatch fails, and every successful mutation returns fresh Provider-produced state. Coordinate operations return visual evidence; semantic operations return accessibility evidence.

The macOS Provider supports fixed element and coordinate actions for click, drag, value setting, text entry, clipboard paste, key combinations, four-direction scroll, and secondary action. It does not execute model-authored scripts. Native application semantics use Accessibility; complete Desktop input uses Core Graphics without requiring a frontmost Accessibility process; Desktop pixels use `screencapture`. Pixel results declare their actual scope. Accessibility and Screen Recording permission failures use stable recovery codes, and visual capture never silently becomes semantic success.

Computer mutations and visual observations continue through the approval service. ACP offers one-shot decisions and a tool-specific allow-for-task decision stored only in the live session record. A task grant avoids repeated dialogs for the same tool, does not grant other tools, and disappears with the session.

The bundled Computer Use Skill instructs the model to prefer purpose-built APIs or CLIs, observe a known target directly, use semantic elements before pixels and coordinates, consume fresh post-action state, avoid blind retries, and verify an authoritative final state. UI and document text remain untrusted content rather than instructions.

Global delivery acceptance remains a policy over outcomes rather than a second execution loop. Read-only work cites the authoritative state inspected; code and file changes inspect the final diff or files and run the smallest relevant checks; external and UI mutations inspect the resulting remote or application state; visual artifacts load their format-owned verification Skill. Confirmed authoritative success is a stopping signal. `agent-loop`, session format, and scheduling are unchanged.

## Verification

Capability, browser, macOS, tool, delivery-policy, Goal, assembled ACP, and cross-client tests pin routing, direct observation, task-scoped approval, fresh-state invalidation, Agent isolation, permission errors, frontmost-process-independent Desktop input, Desktop visual evidence, and outcome-proportional completion. Generated catalogs and bilingual subsystem documentation project the same public types. Desktop distribution verification launches the relocated packaged application and checks its runtime closure.

## Alternatives considered

**Enforce observation and verification after every tool call inside `agent-loop`.** Rejected because the core loop cannot know whether a tool changed authoritative state or which evidence is sufficient. It would create redundant rounds and couple scheduling to every capability.

**Add a general validator workflow with retries and completion certificates.** Rejected because the existing capability, Skill, delivery policy, Goal, and snapshot extension points already own the required behavior. A second orchestration framework would duplicate lifecycle state without improving evidence quality.

**Expose one tool per gesture or one Skill per application.** Rejected because both inflate tool and prompt surfaces while fragmenting one interaction model. A closed action union and one general Skill keep the capability bounded.

**Use screenshots and coordinates for every application.** Rejected because accessibility and browser semantics are cheaper, more stable, and directly verifiable. Pixels remain an explicit fallback for canvas, layout, and controls without useful semantic state.

## Consequences

Computer control now composes browser, native application, and Desktop targets without a global Provider hiding another Provider. Mutations cannot legitimately continue from stale or invented element ids, and failed dispatch leaves the next turn recoverable through a fresh observation. Desktop operations provide post-action visual evidence, while permissions and unsupported operations remain distinguishable.

The design intentionally gives up OCR, computer-vision locators, arbitrary scripts, macro recording, persistent automation, application-specific catalogs, and generic polling. Accessibility trees and animated interfaces can still require bounded visual fallback or a new observation after settling. Acceptance guidance can still over-verify if future prompts ignore authoritative stopping signals, so assembled snapshots must retain simple read-only and already-satisfied cases alongside mutation cases.
