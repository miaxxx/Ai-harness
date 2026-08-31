# Agent Note: Global final-state delivery acceptance

Status: implemented

English | [中文](2026-08-31-global-delivery-acceptance.zh.md)

## Problem

An autonomous task can produce a plausible artifact and conclude from progress narration or an earlier check even though the final edit introduced a defect. Visual deliverables need render-and-inspect evidence, while code, spreadsheets, research, and other outputs require different deterministic checks. Putting every format rule into the agent loop would couple scheduling to artifact tools and make each new format a loop change.

## Decision

- **A global prompt policy owns completion procedure.** `@deepseek-ai/dsh-delivery-quality-policy` contributes one static `policy:delivery-quality` system-prompt section. Before claiming completion, the agent derives observable checks from the request, validates the final state after the last meaningful change, repairs failures, and reruns affected checks. It reports only checks actually performed.
- **One bundled Skill routes type-specific acceptance.** `delivery-verification` applies to artifact-producing tasks and sourced research. Its entrypoint contains the shared acceptance loop and routes to focused references for code, browser UI, documents, PDFs, presentations, spreadsheets, images, and research. Mixed deliverables load every applicable reference. This is progressive disclosure rather than eight catalog entries that repeat the same trigger and loop.
- **Existing Skill selection supplies the mandatory load rule.** `dsh-tool-skill` already tells the model to load every Skill whose description clearly matches the task before taking task actions. The global policy names `delivery-verification` when that Skill appears in the catalog. Every full product preset exposes the shared bundled Skill root; the fixed-prompt Minimal preset intentionally has no Skill catalog. No classifier or second routing service is introduced.
- **Goal prompts use the same completion standard.** Goal creation guidance requires a concrete outcome, constraints, and verification criteria. Each Goal Round asks for current evidence after the final meaningful change and sends failed checks back through repair and re-check before `update_goal complete`. Goal persistence and the agent loop remain unchanged.
- **Verification remains format-owned.** Tests, renderers, browser inspection, workbook recalculation, PDF page rendering, and source checks remain the authorities for their own results. The global policy coordinates them but does not claim a universal pass/fail signal.

## Verification

The policy package test pins the registered section, its final-state and repair-loop requirements, and disposal. The Web preset composition test requires the bundled Skill in Code, Work, Standard, and Cordis catalogs. The product headless keyless snapshot runs a real assembled turn and asserts that the persisted request header carries the global final-state policy. Goal package tests pin the revised model-visible creation and continuation guidance. Skill validation checks the new entrypoint and its discoverable references. Bundle, type, documentation, and workspace gates cover packaging and publication.

## Alternatives considered

- **A completion certificate tool** — rejected because a model-authored certificate restates the claim without independently validating it. A trustworthy certificate would need format providers and artifact ownership not present in the harness.
- **A tool-name allowlist before `update_goal complete`** — rejected because tool names vary by deployment, successful invocation does not establish output quality, and ordinary non-Goal turns would bypass it.
- **Artifact detection inside `agent-loop`** — rejected because the loop owns model and tool scheduling, not file formats or acceptance semantics. The documented prompt, Skill, and Goal extension points cover the behavior without changing the loop.
- **One acceptance Skill per format** — rejected because every entry would repeat the same final-state repair loop and broad artifact trigger. One router keeps catalog cost and maintenance small while references preserve format-specific instructions.

## Consequences

- Every base-bundle agent receives a stable completion standard; product agents additionally receive format-specific procedures.
- Visual acceptance requires opening rendered final output rather than inferring quality from source or export success.
- A failed check keeps work active and causes another repair-and-verify pass. An unavailable verifier is reported as an unverified limitation, never a pass.
- Complete personas still suppress all other prompt sections by design and therefore own their entire completion policy.
