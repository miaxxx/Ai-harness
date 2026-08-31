# @deepseek-ai/dsh-delivery-quality-policy

English | [中文](README.zh.md)

A zero-config prompt policy that makes final-state acceptance part of every composed agent turn. It does not change the agent loop, inspect files, or judge artifacts itself. The policy tells the model to derive observable checks from the request, verify after the final meaningful change, inspect rendered visual output, repair failures, and repeat affected checks before claiming completion.

Requires `ctx.systemPrompt` and registers the `policy:delivery-quality` section at order `120`.

```yaml
- id: delivery-quality-policy
  name: '@deepseek-ai/dsh-delivery-quality-policy'
```

The base bundle mounts the policy globally. Product presets also expose the bundled `delivery-verification` Skill. The policy requires that Skill when it appears in the session catalog; the Skill routes to type-specific acceptance for code, browser UI, documents, PDFs, presentations, spreadsheets, images, and sourced research. The existing skill-catalog rule supplies deterministic selection semantics: a task that clearly matches the Skill description must load it before task actions.

The policy creates no session event, tool schema, service, mutable state, or per-artifact classifier. Model-visible prompt reconstruction remains owned by `dsh-system-prompt` and the request header. The final response must name the deliverables and checks actually performed; an unavailable verifier remains an explicit limitation rather than an implied pass.

## Model Experience

### Final-state acceptance section

#### What the model sees

The static `policy:delivery-quality` section requires an observable final-state acceptance pass, the bundled verification Skill when available, render-and-inspect checks for visual artifacts, and a repair-and-recheck loop for failed checks. It also requires the final response to name only verification actually performed.

#### Token effect

Fixed policy text appears in every request whose effective prompt is not replaced by a complete section. Type-specific procedures remain outside the prompt until `delivery-verification` is loaded, so unrelated reference text costs no tokens.

#### KV Cache effect

Prefix-stable for the process lifetime. The global section mounts before agents are created and never changes, so later turns reuse the same prompt prefix.

## Known Limitations and Deferred Work

- The policy enforces model procedure, while deterministic tools remain the authority for individual checks. A universal host-side pass/fail classifier would need artifact ownership and format-specific providers that the harness does not have.
- A complete persona intentionally suppresses every other prompt section, including this policy. Such a preset owns its entire completion policy.
- Deployments without the bundled Skill still receive the global acceptance loop and use available tools directly.

Design: [global final-state delivery acceptance](../../../.agents/notes/implemented/feature/2026-08-31-global-delivery-acceptance.md).
