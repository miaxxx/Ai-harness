# preset/ — per-session agent composition

English | [中文](README.zh.md)

An **agent preset** is a directory holding one `agent.cordis.yml`. Mounting it under an agent's scope context gives that session its own tools and prompt sections while every other live session keeps its own, so one process can run several differently composed agents at once.

| Package | Role | ctx key |
|---|---|---|
| `agent-presets/` | Preset vocabulary, filesystem discovery over trusted and user-authored roots, and the guarded per-agent mount | `ctx.agentPresets` |
| `persona/` | The agent persona as a composable row, so a preset can change identity and not only tools | — |

The presets the deployment ships live in [`apps/cli/config/agent-presets/`](../../apps/cli/config/agent-presets) — one directory each, and that directory listing is the roster. Naming them here too would be a second list to keep in step, and the first one to fall behind.

Every full product preset shares the bundled task skills under [`apps/cli/config/skills/`](../../apps/cli/config/skills); only the deliberately fixed-prompt Minimal preset omits the Skill tool and catalog. Skill descriptions select the relevant workflow from the user's request, so the presets do not add a second routing service. The cross-cutting `delivery-verification` Skill routes its final acceptance pass by artifact type, while the authoring Skills retain their narrower task workflows. Code keeps Code Mode tool presentation, while Work keeps native tools for research and document tasks.

The composition split this group assumes: registries and cross-session facilities are process singletons and stay in the host composition, while a preset carries what one agent contributes to them. A preset that names a row publishing a process-global service is rejected at mount rather than allowed to collide with the next session.

Design: [the per-session agent-preset note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md).
