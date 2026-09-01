# @deepseek-ai/dsh-delivery-quality-policy

English | [中文](README.zh.md)

A zero-config prompt policy that makes evidence-based stopping part of every composed agent turn. It does not change the agent loop, inspect files, operate applications, or judge artifacts itself. The policy tells the model to compare authoritative current state with the requested outcome, stop when that outcome is already satisfied, and use evidence proportional to the kind of work performed.

Requires `ctx.systemPrompt` and registers the `policy:delivery-quality` section at order `120`.

```yaml
- id: delivery-quality-policy
  name: '@deepseek-ai/dsh-delivery-quality-policy'
```

The policy distinguishes four completion surfaces instead of forcing one universal validator:

- **Read-only questions and research:** a relevant answer grounded in authoritative information or the requested sources is evidence. No mutation is required merely to prove completion.
- **Code and file mutations:** inspect the final files or diff and run the relevant deterministic checks such as tests, typecheck, or build.
- **External and GUI mutations:** require fresh post-action observation showing the requested external state. Tool-call success alone is not outcome evidence.
- **Produced or edited artifacts:** use the bundled `delivery-verification` Skill when available and follow its type-specific acceptance procedure, including render/open/recalculate inspection where appropriate.

The policy rejects stale or incidental evidence. Progress narration, file existence alone, screenshots captured before the latest mutation, unrelated documentation rereads, and blind retries of unchanged or rejected actions do not establish completion. Failed checks return the model to repair and re-check; a concrete permission, user-input, external-service, or external-state blocker is reported rather than disguised as success.

The policy creates no session event, tool schema, service, mutable state, per-artifact classifier, or completion certificate. Model-visible prompt reconstruction remains owned by `dsh-system-prompt` and the request header. Existing Skills and deterministic tools remain the authorities for their own domains.

## Model Experience

### Outcome-evidence section

#### What the model sees

The static `policy:delivery-quality` section establishes one stopping rule: compare fresh authoritative state with the requested outcome, continue only while evidence says it is unsatisfied, and stop without unnecessary changes when it is satisfied. It then names the evidence expected for read-only, code/file, external/GUI, and artifact-producing work.

#### Token effect

Fixed policy text appears in every request whose effective prompt is not replaced by a complete section. Type-specific artifact procedures remain outside the prompt until `delivery-verification` is loaded, so unrelated reference text costs no tokens.

#### KV Cache effect

Prefix-stable for the process lifetime. The global section mounts before agents are created and never changes, so later turns reuse the same prompt prefix.

## Known Limitations and Deferred Work

- The policy constrains model procedure; deterministic tools and authoritative external observations still decide individual checks. A universal host-side pass/fail classifier is intentionally not introduced.
- A complete persona intentionally suppresses every other prompt section, including this policy. Such a preset owns its entire completion policy.
- Deployments without bundled Skills still receive the general evidence rules and use available tools directly.

Design background: [global final-state delivery acceptance](../../../.agents/notes/implemented/feature/2026-08-31-global-delivery-acceptance.md) and the Computer Use/task-acceptance follow-up implemented by the current feature branch.
