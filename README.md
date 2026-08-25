# repo-remote

A tiny control repository for safely updating allowlisted GitHub repository settings and pruning proven-merged branches through Issues and GitHub Actions.

`repo-remote` is a bridge: an authorized, explicitly labeled Issue becomes a narrowly scoped command, and GitHub Actions applies that command to another repository owned by the control-repository owner.

## Architecture flow

```mermaid
flowchart TD
  A[Authorized Issue with repo-remote:command label] --> B[Workflow gate\n(author + actor allowlist)]
  B --> C[Schema + semantic validation\n(PAT-free)]
  C --> D{dry_run?}
  D -->|yes| E[Read-only execution\n(no REPO_REMOTE_TOKEN)]
  D -->|no| F[Allowlisted operation execution\n(with REPO_REMOTE_TOKEN)]
  E --> G[Audit comment + close]
  F --> G
```

## What it can change

Only these operations are supported:

- `description` — GitHub About description
- `homepage` — GitHub About website URL
- `topics` — GitHub repository topics
- `is_template` — enable or disable GitHub's Template repository setting
- `delete_branch_on_merge` — enable or disable GitHub's **Automatically delete head branches** setting
- `branch_cleanup.mode: "merged"` — prune current branch heads that GitHub records as same-repository PRs merged into the current default branch

For day-to-day branch hygiene, prefer `delete_branch_on_merge: true`: configure it once and let GitHub remove future merged PR head branches automatically. `branch_cleanup` is intended as an occasional cleanup tool for repositories that already accumulated stale merged branches.

The cleanup operation is intentionally narrower than general branch deletion. It does **not** accept an explicit branch to delete, a ref, a wildcard, a prefix, an age, or an API path. Repository deletion, visibility changes, transfers, archiving, renaming, arbitrary GitHub API calls, arbitrary Contents operations, tags, ref updates, and arbitrary shell commands remain unsupported.

## Command format

Create an Issue with the label **`repo-remote:command`** whose body is JSON (the included Issue form can pre-apply this label):

```json
{
  "version": 1,
  "repository": "Word-Terrarium",
  "description": "A tiny word terrarium for watching semantic relationships grow.",
  "homepage": "https://example.com/word-terrarium/",
  "topics": [
    "creative-coding",
    "semantic-network",
    "javascript",
    "digital-toy",
    "github-pages"
  ]
}
```

To enable a repository as a GitHub template:

```json
{
  "version": 1,
  "repository": "Merge-Studio",
  "is_template": true
}
```

Set `is_template` to `false` to turn the setting off again.

To make GitHub automatically delete a pull request's head branch after merge:

```json
{
  "version": 1,
  "repository": "xlsx-ray",
  "delete_branch_on_merge": true
}
```

Set `delete_branch_on_merge` to `false` to disable automatic head-branch deletion again. This is a repository setting handled through the same allowlisted repository PATCH path as other Administration-backed settings; it does not directly delete a Git ref and does not require Contents write by itself.

To inspect safely removable merged branches without exposing the cross-repository PAT:

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

To apply that cleanup, submit it as a standalone command and confirm it explicitly:

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

For each current branch, cleanup skips the current default, every validated `keep` entry, protected branches, and branches with open same-repository PRs. A deletion candidate must have a GitHub PR record whose head repository and branch exactly match the target, whose base is the current default branch, whose `merged_at` is set, and whose recorded head SHA still equals the current branch SHA. The current default, open-PR state, branch head, and PR evidence are checked again immediately before the derived `refs/heads/<branch>` deletion. Git ancestry alone is never treated as merge evidence.

Dry-run cleanup reports candidates and skip reasons using GitHub's public read endpoints and deliberately ignores `REPO_REMOTE_TOKEN`, even if it is accidentally present. Consequently, dry-run cleanup is available only for repositories readable without that PAT. Applied cleanup reports deleted and skipped branch names in the success Issue comment.

`repository` may also be written as `OWNER/Word-Terrarium`. Any owner other than the control repository owner is rejected.

`version` is required and must currently be `1`. Unknown keys are rejected. All mutation fields are optional individually, but at least one of `description`, `homepage`, `topics`, `is_template`, `delete_branch_on_merge`, or `branch_cleanup` must be present. Because cleanup is destructive, `branch_cleanup` cannot be combined with repository-setting changes in one command.

To validate a command without changing anything:

```json
{
  "version": 1,
  "repository": "Word-Terrarium",
  "topics": ["creative-coding", "digital-toy"],
  "dry_run": true
}
```

Dry runs never receive or use the cross-repository PAT.

## One-time setup

The standard Actions `GITHUB_TOKEN` is scoped to this repository and cannot administer sibling repositories. `repo-remote` therefore currently needs one fine-grained personal access token stored as an Actions secret.

1. In GitHub, create a **fine-grained personal access token**.
2. Set the resource owner to the account that owns the repositories to control.
3. Prefer **Selected repositories** and grant access only to repositories that `repo-remote` needs to manage. Use broader access only when it is genuinely required.
4. Grant only the repository permissions needed by the enabled operations:
   - **Administration — Read and write** for description, homepage, topics, `is_template`, and `delete_branch_on_merge`.
   - **Contents — Read and write** only when using `branch_cleanup`, for listing branches and deleting a proven branch ref.
   - **Pull requests — Read-only** only when using `branch_cleanup`, for checking merged and open PR state.
5. In this repository, open **Settings → Secrets and variables → Actions → New repository secret**.
6. Name the secret `REPO_REMOTE_TOKEN` and paste the token.
7. Create the Issue label `repo-remote:command`.
8. Optional: create an Actions repository variable named `ALLOWED_ACTORS` containing a JSON array of additional GitHub logins, such as `["alice","octocat"]`. Leave it unset or set it to `[]` for owner-only operation.

If you use this repository as a **GitHub template**, each copy runs inside the new owner's own repository and Actions account. Template copies do **not** inherit upstream secrets, including `REPO_REMOTE_TOKEN`; each user must create and store their own token in their own repository settings.

GitHub groups repository metadata updates, template-repository toggling, and automatic merged-head-branch deletion under Administration permission. Its [Delete a reference](https://docs.github.com/en/rest/git/refs#delete-a-reference) endpoint requires Contents write, while [List pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests) requires Pull requests read. Contents write is therefore needed only for the optional `branch_cleanup` path, not for `delete_branch_on_merge`. Contents write is a material increase in credential blast radius even though repo-remote implements no arbitrary Contents or ref operation. Keep the token on **Selected repositories**; the checked-in schema, parser, planner, and workflow remain the narrower policy boundary.

`REPO_REMOTE_TOKEN` is the primary blast-radius concern. Prefer short token expiry, rotate regularly, and revoke immediately if you suspect exposure.

Workflow usage costs are paid by the repository that runs the workflow (your template copy), not by the upstream `yo4e/repo-remote` repository. For public repositories, GitHub-hosted standard runner usage is currently free, subject to GitHub policy changes.

See [SECURITY.md](SECURITY.md) for token rotation, actor authorization, workflow hardening, and the optional protected-environment setup.

## Security model

This repository may be public, but commands are deliberately constrained:

- only Issues carrying the explicit `repo-remote:command` label are considered;
- the repository owner is authorized by default; additional actors require explicit `ALLOWED_ACTORS` configuration;
- both the Issue author and the account that triggered the current event must be authorized; closed Issues and manual re-runs cannot execute;
- target owner is hard-locked to the control repository owner;
- every command must match the checked-in versioned JSON Schema;
- unknown command keys are rejected;
- only `description`, `homepage`, `topics`, `is_template`, `delete_branch_on_merge`, and the fixed `branch_cleanup: merged` operation are implemented;
- repository PATCH payloads are constructed only from those individually allowlisted fields; arbitrary settings objects are never accepted;
- malformed commands are rejected before the cross-repository PAT is exposed to a step;
- non-dry-run cleanup is rejected before PAT exposure unless `confirm: true` is present;
- cleanup candidates require exact same-repository merged-PR evidence into the current default at the current branch head, and the destructive boundary is rechecked before deletion;
- default, protected, kept, open-PR, fork-head, unmerged, non-default-base, and advanced/reused branch cases are not deleted;
- dry runs execute without the PAT, and the runtime ignores any accidentally supplied PAT for them;
- token values and Authorization headers are redacted from runtime error logs;
- Issue text is passed to the parser as data, not executed as shell code;
- successful commands are commented on and closed; failures remain open with a link to the Actions run.

## Why Issues?

ChatGPT's connected GitHub tooling and many other agents can create Issues even when a particular GitHub REST write endpoint is not exposed directly. This repository turns that common capability into a small, auditable command queue.

The Issue history is also a useful operation log: every requested metadata change remains visible and attributable.

## Troubleshooting

- **Workflow did not run:** confirm the Issue is open, has the `repo-remote:command` label, and both the Issue author and event actor are authorized by owner/default policy or `ALLOWED_ACTORS`.
- **`REPO_REMOTE_TOKEN is not configured`:** add the secret in **Settings → Secrets and variables → Actions** of your own repository copy.
- **Cross-owner rejected:** set `repository` to either `name` or `OWNER/name` where `OWNER` matches `github.repository_owner`.
- **Dry-run cleanup fails on private target:** dry-run cleanup is PAT-free and needs public read visibility.

## Files

```text
.github/workflows/repo-remote.yml  # authorized Issue → Actions bridge
.github/workflows/ci.yml           # dependency-free parser/security tests
schemas/command-v1.schema.json     # versioned command policy
scripts/command.mjs                # schema + semantic validation
scripts/validate-command-cli.mjs   # validation step without PAT
scripts/apply-command.mjs          # GitHub REST mutations
scripts/branch-cleanup.mjs         # pure merged-branch planner + destructive rechecks
scripts/security.mjs               # log redaction
SECURITY.md                        # token/actor/workflow security guidance
README.md                          # protocol and setup
```

## Release notes

This project follows semantic versioning. See [CHANGELOG.md](CHANGELOG.md) for release history (`v0.1.0` is the first public OSS release baseline).

See also: [LICENSE](LICENSE), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
