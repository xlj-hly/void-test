---
name: pre-commit-doc-review
description: Review project documentation against the implementation before any git commit in this repository, including --amend. Load only when preparing a commit.
---

# Pre-commit Documentation Review

Before every `git commit`, verify that all maintained documentation matches the current implementation and pending changes.

## Scope

- Review `README.md`, `AGENTS.md`, skills and guidance in `.agents/`, `docs/`, other project documentation, and diagrams with their source data.
- Exclude third-party dependencies, caches, and generated delivery or validation records.
- In `.archify/`, version and review only diagrams (e.g. `*.html`) and source data (e.g. `candidate.json`). Exclude `*.delivery.json` and `organization-verified/` from Git and review; they may remain local for tool checks.

## Checks

- Verify business rules, behavior, APIs, directory structure, dependencies, commands, configuration, environment variables, testing and deployment instructions, examples, and links.
- Fix outdated, incorrect, or missing information. Leave accurate content unchanged; do not refresh dates or make cosmetic edits merely to record a review.

## Commit requirements

- Include related documentation updates in the same commit as the code. Do not commit with unresolved inconsistencies or unverified items.
- Before committing, report the review scope, updated documents, and reasons for leaving documents unchanged.
