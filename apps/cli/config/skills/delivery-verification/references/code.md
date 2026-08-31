# Code acceptance

- Inspect the final diff and confirm every changed file serves the requested behavior. Remove accidental debug output, dead branches, and unrelated edits introduced by the task.
- Run the smallest relevant tests plus the type, lint, build, or static checks required by the repository for the changed surface.
- Exercise the changed behavior through its real public path when practical. A unit test alone does not establish assembled behavior when the repository requires an integration or snapshot path.
- Check failure behavior and cleanup for changed lifecycle, concurrency, subprocess, persistence, or external-call paths.
- Treat a failing relevant check as a product defect. Diagnose it, repair the implementation or an obsolete expectation, and rerun the affected checks.

Acceptance requires a reviewable final diff, passing relevant checks, and no known regression in the requested behavior. Record the exact checks run and any environment-owned check that remains unavailable.
