---
name: ship-pr
description: Merge a PR, sync main, wait for CI, and verify the change is actually live in production — the full "ship it" loop for betuveto.
---

Given a PR number (ask if not provided):

1. **Confirm before merging.** State the PR number and title, and wait for explicit go-ahead — merging and deploying is real-world blast radius (per the user's global CLAUDE.md, this is a "confirm first, every time" action, not something to do autonomously).
2. `gh pr merge <n> --squash --delete-branch`, with a `--subject`/`--body` summarizing the change (reuse the PR body if it's already good).
3. `git checkout main && git pull`, then confirm the merge commit is at HEAD (`git log --oneline -3`).
4. Poll `gh run list --branch main --limit 1` a few seconds apart until the post-merge run finishes (API typecheck/unit-test job and frontend lint/build job — note betuveto's CI has no frontend test step, so a green run doesn't mean frontend tests ran). If a job fails, stop and report — don't proceed to step 5 on a red run.
5. Verify the change is actually live: curl the production URL (check project memory / README / `vercel.json` for it) and confirm the response reflects the change, not just that Vercel/CI reports success.

## Reporting

Report three things as separate lines, don't collapse them: the merged PR, the CI run result, and what was actually observed live. "CI passed" is not the same claim as "verified live."
