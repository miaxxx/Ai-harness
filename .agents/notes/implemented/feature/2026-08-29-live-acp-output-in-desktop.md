# Agent Note: Live ACP output in Desktop

Status: implemented

English | [中文](2026-08-29-live-acp-output-in-desktop.zh.md)

## Problem

Desktop received committed ACP messages and tool updates, but a model's text and reasoning deltas were withheld until the request completed. The input surface also gave no clear feedback before the first visible result, making an active turn appear stalled.

## Decision

The ACP bridge now forwards text deltas as `agent_message_chunk` and reasoning deltas as standard `agent_thought_chunk` updates while the request is active. It records which text blocks have already crossed the wire so the committed assistant message does not repeat them; blocks that arrive only at completion, such as an image or a text-only block-end, remain delivered from the committed message.

Desktop coalesces adjacent text or reasoning deltas within each ACP message instead of creating one presentation block per delta. While ACP is active, the Desktop adapter projects accumulated assistant blocks as `assistant/chunk` events; after completion it projects the same accumulated reasoning and text as the finalized message. This keeps the Think disclosure streaming during generation and prevents a later text message from replacing reasoning produced under a different ACP message id. A live Think disclosure opens with its full reasoning text visible and remains user-collapsible. The user-configured OpenAI-compatible primary model declares `off` and `high` reasoning efforts and runs at `high`, allowing its reasoning stream to enter ACP. The adapter keeps the synthetic turn open until ACP reports that the request has ended, so tool calls remain visibly in progress. The shared composer shows a localized live status: thinking before an active tool is known, then the active tool's name. Its surface and text layers are explicitly isolated and opaque, with the textarea and native caret above the decoration layer.

ACP projects a user-role message into the product transcript only when its durable source is the human user. Plugin-authored runtime context, system reminders, and skill instructions remain available to the model without appearing as assistant or user chat content.

## Alternatives considered

**Keep ACP committed-output-only.** This preserves the former failure and retry semantics, but it leaves product clients without any output until an entire model request has completed.

**Add a second Desktop-only transport.** A parallel stream would duplicate session presentation and drift from CLI and other ACP clients. The standard ACP chunk updates already carry the required real-time information.

**Show a simulated typing animation after completion.** This improves perceived latency but does not represent model or tool progress and cannot show reasoning or tool activity truthfully.

## Consequences

- ACP clients receive text and reasoning as they are produced, and Desktop displays them during the turn.
- Stream deltas form normal paragraphs and Markdown blocks rather than one visual block per token.
- Runtime context and system instructions do not appear in the product transcript.
- Tool calls remain in the running state until their result or the request completion arrives.
- An interrupted or retried request can leave its already displayed prefix visible because ACP has no retraction update; a subsequent attempt receives a distinct stream message id.
- The input remains visually opaque during theme initialization, and focus exposes a native insertion caret.
- Images and text emitted only as completed blocks retain the existing committed-message delivery path.
