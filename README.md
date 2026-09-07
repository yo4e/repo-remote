# repo-remote

A tiny, auditable GitHub control bridge for AI agents and automation. An authorized, explicitly labeled Issue becomes a narrowly scoped command, and GitHub Actions applies only the operations that `repo-remote` explicitly allows.

## Project status

The **current core is feature-complete for its intended use** and is now in maintenance mode: use it, fix bugs when they appear, and add operations only when a real need justifies widening the policy boundary.

Stable core:

- update repository **description**, **homepage**, and **topics**;
- toggle **Template repository** (`is_template`);
- toggle GitHub's **Automatically delete head branches** setting (`delete_branch_on_merge`);
- safely prune already-merged same-repository branches with `branch_cleanup.mode: "merged"`;
- validate commands with a versioned schema, bounded input, owner/actor authorization, dry-run support, structured audit evidence, and PAT-free validation where applicable.

Implemented but **not part of the recommended baseline deployment**:

- `wiki.list`, `wiki.read`, and `wiki.upsert` exist behind the same narrow policy boundary, but live Wiki rollout is deferred because Git-backed Wiki access adds setup and token-scope friction for comparatively low value in current use. The implementation is retained for future use; see [docs/wiki-operations.md](docs/wiki-operations.md).

Future ideas such as GitHub App authentication and archive/unarchive are tracked in [Issue #4](https://github.com/yo4e/repo-remote/issues/4). They are not current work items.

## What it can change

### Stable operations

- `description` — GitHub About description
- `homepage` — GitHub About website URL
- `topics` — repository topics
- `is_template` — enable or disable GitHub's Template repository setting
- `delete_branch_on_merge` — enable or disable GitHub's automatic merged-head-branch deletion
- `branch_cleanup.mode: "merged"` — prune current branch heads that GitHub records as same-repository PRs merged into the current default branch

The destructive cleanup operation is intentionally narrower than general branch deletion. It does **not** accept an explicit branch to delete, a ref, wildcard, prefix, age rule, or arbitrary API path.

Repository deletion, visibility changes, transfers, archiving, renaming, arbitrary GitHub API calls, arbitrary Contents operations, tags, ref updates, branch-protection changes, and arbitrary shell commands remain unsupported.

### Deferred / optional Wiki operations

The codebase also contains `wiki.upsert`, `wiki.read`, and `wiki.list`. Wiki input is a page title, never a path; the remote is derived internally as `https://github.com/<owner>/<repo>.wiki.git`; rename/delete, force-push, arbitrary remotes, and arbitrary filesystem paths are not supported.

These operations are retained as an experimental/deferred capability rather than advertised as part of the stable core. See [docs/wiki-operations.md](docs/wiki-operations.md) for the implementation boundary and setup caveats.

## Command format

Create an Issue with the label **`repo-remote:command`** whose body is JSON.

Example metadata update:

```json
{
  "version": 1,
  "repository": "Word-Terrarium",
  "description": "A tiny word terrarium for watching semantic relationships grow.",
  "homepage": "https://yo4e.github.io/Word-Terrarium/",
  "topics": [
    "creative-coding",
    "semantic-network",
    "javascript"
  ]
}
```

Enable a repository as a template:

```json
{
  "version": 1,
  "repository": "Merge-Studio",
  "is_template": true
}
```

Enable automatic deletion of future merged PR head branches:

```json
{
  "version": 1,
  "repository": "xlsx-ray",
  "delete_branch_on_merge": true
}
```

Inspect safely removable merged branches without exposing the cross-repository PAT:

```json
{
  "version": 1,
  "repository": "xlsx-ray",
  "branch_cleanup": {
    "mode": "merged",
    "keep": ["release/publish-v0.1.0"]
  },
  "dry_run": true
}
```

Apply the cleanup as a standalone command with explicit confirmation:

```json
{
  "version": 1,
  "repository": "xlsx-ray",
  "branch_cleanup": {
    "mode": "merged",
    "keep": ["release/publish-v0.1.0"],
    "confirm": true
  }
}
```

For each current branch, cleanup skips the current default, every validated `keep` entry, protected branches, and branches with open same-repository PRs. A candidate must have a GitHub PR record whose head repository and branch exactly match the target, whose base is the current default branch, whose `merged_at` is set, and whose recorded head SHA still equals the current branch SHA. The destructive boundary is checked again immediately before deletion. Git ancestry alone is never treated as merge evidence.

Dry-run cleanup uses GitHub's public read endpoints and deliberately ignores `REPO_REMOTE_TOKEN`, so it works only for repositories readable without that PAT.

`repository` may also be written as `OWNER/repository`; any owner other than the control repository owner is rejected.

`version` is required and must currently be `1`. Unknown keys are rejected. The complete Issue body is limited to **131,072 UTF-8 bytes**, parsed JSON to **16 levels of depth**, and **512 JSON value nodes** before schema validation continues.

## One-time setup

The standard Actions `GITHUB_TOKEN` is scoped to the control repository and cannot administer sibling repositories. `repo-remote` therefore currently uses a fine-grained personal access token stored as an Actions secret.

1. Create a **fine-grained personal access token** in GitHub.
2. Set the resource owner to the account that owns the target repositories.
3. Prefer **Selected repositories** and grant access only to repositories that `repo-remote` must control.
4. Grant only the permissions required by the operations you actually use:
   - **Administration — Read and write** for description, homepage, topics, `is_template`, and `delete_branch_on_merge`.
   - **Contents — Read and write** plus **Pull requests — Read-only** only when using `branch_cleanup`.
   - Optional/deferred Wiki use has additional Contents requirements documented in [docs/wiki-operations.md](docs/wiki-operations.md).
5. Store the token in this repository as the Actions secret `REPO_REMOTE_TOKEN`.
6. Create the Issue label `repo-remote:command`.
7. Optional: create an Actions repository variable `ALLOWED_ACTORS` containing a JSON array of additional GitHub logins. Leave it unset or use `[]` for owner-only operation.

Keep the token on **Selected repositories**, prefer a short practical expiry, rotate it periodically, and revoke it immediately after suspected exposure. Do not widen it to **All repositories** merely to avoid maintaining repository selection.

A future GitHub App authentication mode may reduce long-lived PAT blast radius, but its additional setup and implementation complexity are not justified for the current scale. It remains a future option rather than unfinished core work.

See [SECURITY.md](SECURITY.md) for the complete security boundary and operational guidance.

## Security model

This repository may be public, but privileged execution remains deliberately constrained:

- only Issues carrying `repo-remote:command` are considered;
- the repository owner is authorized by default; additional actors require explicit `ALLOWED_ACTORS` configuration;
- both the Issue author and the account triggering the current event must be authorized;
- closed Issues and manual re-runs cannot execute old commands;
- target owner is hard-locked to the control repository owner;
- request size and JSON complexity are bounded before privileged execution;
- every command must match the checked-in versioned schema and unknown keys are rejected;
- repository PATCH payloads are built only from individually allowlisted fields;
- cleanup requires exact merged-PR evidence and explicit confirmation for real deletion;
- dry runs do not receive the cross-repository PAT;
- malformed commands are rejected before the PAT-bearing step;
- token values and Authorization material are redacted from runtime errors;
- Issue text is parsed as data, never executed as shell code;
- every run records bounded audit evidence, a payload fingerprint, and an Actions run link without repeating the full command body.

Security-sensitive policy lives in the workflow, schema, parser/runtime, tests, and [SECURITY.md](SECURITY.md). CODEOWNERS, full-SHA Action pins, weekly Dependabot checks, CI, and CodeQL provide additional review and supply-chain controls.

## Operations and maintenance

Each copy of repo-remote runs in **that repository owner's own GitHub Actions account**. A template/copy does not inherit the original repository's `REPO_REMOTE_TOKEN`.

Issue events can still create workflow evaluations even when authorization prevents privileged execution, so repository moderation remains relevant if public Issue spam becomes material.

For day-to-day branch hygiene, prefer `delete_branch_on_merge: true`; `branch_cleanup` is an occasional tool for repositories that already accumulated stale merged branches.

The current maintenance posture is intentionally conservative: do not add a new operation merely because GitHub exposes an API for it. Add one when there is a recurring need, then give it its own validation, authorization, audit behavior, tests, and security review.

## Why Issues?

ChatGPT's connected GitHub tooling and many other agents can create Issues even when a particular GitHub REST write endpoint is not exposed directly. `repo-remote` turns that common capability into a small, auditable command queue.

The Issue history also serves as an attributable operation log.

## Development

Requires Node.js 20+.

```bash
npm run check
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and release notes.

## Files

```text
.github/CODEOWNERS                 # review ownership for policy boundaries
.github/dependabot.yml             # weekly GitHub Actions dependency updates
.github/workflows/repo-remote.yml  # authorized Issue → Actions bridge
.github/workflows/ci.yml           # dependency-free parser/security tests
.github/workflows/codeql.yml       # static analysis
schemas/command-v1.schema.json     # versioned command policy
scripts/command.mjs                # schema + semantic validation
scripts/limits.mjs                 # Issue-body / JSON complexity guards
scripts/audit.mjs                  # bounded request fingerprint + audit hints
scripts/validate-command-cli.mjs   # validation step without PAT
scripts/apply-command.mjs          # command dispatcher + GitHub REST mutations
scripts/branch-cleanup.mjs         # merged-branch planner + destructive rechecks
scripts/wiki.mjs                   # retained/deferred Wiki implementation
scripts/security.mjs               # log redaction
docs/wiki-operations.md            # deferred Wiki protocol/safety details
SECURITY.md                        # token/actor/workflow security guidance
CHANGELOG.md                       # notable changes and deferred items
```

## Author / design

Designed by 月野テンプレクス with 山田佳江 as a tiny piece of infrastructure for the `yo4e` GitHub toy box.
