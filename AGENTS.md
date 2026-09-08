## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `receyuki/live2pet`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default mattpocock/skills triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

## Engineering behavior

### Documentation languages

- Maintain `README.md` in English and `README.zh-CN.md` in Simplified Chinese. Update both when changing product behavior, setup instructions, or development commands.
- Preserve the `runtime-setup` anchor in both READMEs: the Desktop App links directly to it according to its current locale.
- Keep issues and other engineering documentation in English unless explicitly requested otherwise.

These principles are adapted for Live2Pet from the behavioral guidance in [`multica-ai/andrej-karpathy-skills`](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md).

### Plan before editing

- Make assumptions and tradeoffs visible before implementation.
- When the request has materially different interpretations, present the alternatives instead of silently choosing one.
- Prefer a simpler path when it meets the same outcome.
- Ask for clarification only when missing information would materially change the result or risk user data.

### Keep the design lean

- Implement the smallest complete solution for the requested behavior.
- Avoid speculative features, premature abstraction, and configuration without a current use case.
- Do not add defensive branches for states the system cannot reach.
- Revisit an implementation when its size or complexity is disproportionate to the problem.

### Keep changes scoped

- Change only files and lines that support the requested outcome.
- Preserve the surrounding style and do not combine feature work with unrelated cleanup.
- Mention unrelated dead code or problems instead of removing them without authorization.
- Remove imports, variables, functions, and files made obsolete by the current change.
- Preserve unrelated local changes and exclude them from the current commit; do not clean them up without authorization.

### Project compatibility and model browsing

- When changing project schemas, source fingerprints, or model selection rules, verify legacy `.live2pet`, `.l2p`, and `.l2pack` opening. An algorithm change alone must not be treated as a Source Package change.
- Keep Source Library search and sorting local to catalog metadata. Preserve lazy thumbnails, bounded caching, and the current selection across navigation; do not trigger whole-library downloads or thumbnail regeneration.
- Route project documents and model resources through their respective import paths. Check the complete drag lifecycle, overlay cleanup, and navigation on both success and failure.
- See `docs/agents/project-import-regressions.md` for focused regression scenarios. These rules do not prescribe a fixed page layout.

### Commits and releases

- Treat committing, pushing, and publishing a Release as separate operations. A push does not imply authorization to publish a Release.
- Honor authorization already given in the conversation; do not repeatedly request confirmation for authorized operations. If an approval review blocks an operation, report the specific blocker.

### Work toward verified outcomes

- Define observable success criteria before implementing multi-step work.
- Pair each plan step with a concrete check such as a test, schema validation, render inspection, or package integrity check.
- For bug fixes, reproduce the failure before changing behavior when practical.
- For refactors, establish a passing baseline and verify the same behavior afterward.
- Continue until the stated checks pass or report the exact blocker and remaining work.
