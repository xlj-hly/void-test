---
name: pre-commit-doc-review
description: Review project documentation against the implementation before any git commit in this repository, including --amend. Load only when preparing a commit.
---

# Pre-commit Documentation Review

Before every `git commit`, verify that the proposed commit and the maintained documentation it affects are consistent. Start with a read-only review and present the proposed actions to the user for approval before carrying them out.

## Scope

- Identify what the command will commit. For a normal commit, use `git diff --cached`. For `--amend`, `-a`, or a path-limited commit, account for the files and content that the command will include.
- Review every document changed by the commit. Also check existing statements about behavior, interfaces, paths, or instructions that the commit changes, even when the document has no diff. Verify the content that will exist after the commit, including any needed corrections.
- For design proposals, verify descriptions of existing behavior against the baseline they cite. Review proposed behavior against the design's stated goals and constraints, and label it as proposed.
- Exclude third-party dependencies, caches, and generated delivery or validation records.
- In `.archify/`, version and review only diagrams (e.g. `*.html`) and source data (e.g. `candidate.json`). Exclude `*.delivery.json` and `organization-verified/` from Git and review; they may remain local for tool checks.

## Checks

- Verify business rules, behavior, APIs, directory structure, dependencies, commands, configuration, environment variables, testing and deployment instructions, examples, and links.
- Identify outdated, incorrect, or missing information within the review scope and propose specific corrections. Leave accurate content unchanged and avoid cosmetic edits merely to record a review.

## Approval and execution

1. Show the user which documents or sections were checked, the proposed corrections, the exact files or portions to stage or unstage, and the proposed commit command and message.
2. Wait for explicit approval of that proposal before editing files as part of this review, changing the staging area, or running `git commit`.
3. After approval, carry out the approved actions and verify the final commit contents. Resolve any remaining inconsistencies before committing. If the corrections or commit contents differ from the approved proposal, present the revised plan and wait for approval.
