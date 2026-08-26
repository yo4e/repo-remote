# repo-remote

A tiny control repository for safely updating allowlisted GitHub repository settings, managing narrowly scoped GitHub Wiki pages, and pruning proven-merged branches through Issues and GitHub Actions.

`repo-remote` is a bridge: an authorized, explicitly labeled Issue becomes a narrowly scoped command, and GitHub Actions applies that command to another repository owned by the control-repository owner.

## What it can change

Only these operations are supported:

- `description` — GitHub About description
- `homepage` — GitHub About website URL
- `topics` — GitHub repository topics
- `is_template` — enable or disable GitHub's Template repository setting
- `delete_branch_on_merge` — enable or disable GitHub's **Automatically delete head branches** setting
- `branch_cleanup.mode: "merged"` — prune current branch heads that GitHub records as same-repository PRs merged into the current default branch
- `wiki.upsert` — create or replace one root-level Markdown Wiki page
- `wiki.read` — read one root-level Markdown Wiki page into the Issue result
- `wiki.list` — list root-level Markdown Wiki pages

For day-to-day branch hygiene, prefer `delete_branch_on_merge: true`: configure it once and let GitHub remove future merged PR head branches automatically. `branch_cleanup` is intended as an occasional cleanup tool for repositories that already accumulated stale merged branches.

The destructive cleanup operation is intentionally narrower than general branch deletion. It does **not** accept an explicit branch to delete, a ref, a wildcard, a prefix, an age, or an API path. Wiki operations likewise do **not** accept a Git remote, URL, filesystem path, branch, force push, rename, or delete request. Repository deletion, visibility changes, transfers, archiving, renaming, arbitrary GitHub API calls, arbitrary Contents operations, tags, ref updates, and arbitrary shell commands remain unsupported.

## Command format

Create an Issue with the label **`repo-remote:command`** whose body is JSON.

Repository-setting commands keep the compact v1 form:

```json
{
  "version": 1,
  "repository": "Word-Terrarium",
  "description": "A tiny word terrarium for watching semantic relationships grow.",
  "homepage": "https://yo4e.github.io/Word-Terrarium/",
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

### Wiki operations

Wiki operations use an explicit operation family. To create or replace one Markdown page:

```json
{
  "version": 1,
  "repository": "templex-soul",
  "operation": "wiki.upsert",
  "params": {
    "page": "Architecture",
    "content": "# Architecture\n\n...",
    "message": "Update Architecture wiki"
  }
}
```

`message` is optional. Add `"dry_run": true` to validate a `wiki.upsert` command, including its page name and content bounds, without exposing the PAT or cloning the Wiki.

To read one page:

```json
{
  "version": 1,
  "repository": "templex-soul",
  "operation": "wiki.read",
  "params": {
    "page": "Architecture"
  }
}
```

To list pages:

```json
{
  "version": 1,
  "repository": "templex-soul",
  "operation": "wiki.list",
  "params": {}
}
```

Wiki input is a page title, never a path. The remote is always derived internally as `https://github.com/<owner>/<repo>.wiki.git`. Page names are normalized to one root-level `.md` file and traversal/path separators are rejected. Contents are written through file APIs rather than shell interpolation, and Git runs without a shell. `wiki.rename` and `wiki.delete` are not supported.

A GitHub Wiki must already have its initial page before the backing `.wiki.git` repository can be cloned. If a target Wiki has never been initialized, create and save one page from the target repository's **Wiki** tab, then retry. See [docs/wiki-operations.md](docs/wiki-operations.md) for details.

`repository` may also be written as `OWNER/Word-Terrarium`. Any owner other than the control repository owner is rejected.

`version` is required and must currently be `1`. Unknown keys are rejected. A command must contain either at least one supported compact repository-setting field, the standalone `branch_cleanup` object, or an explicit supported Wiki `operation` plus `params`. Wiki and branch-cleanup operations cannot be mixed with repository-setting changes.

To validate a repository-setting command without changing anything:

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
   - **Contents — Read-only** for `wiki.read` / `wiki.list` when no Wiki write capability is needed.
   - **Contents — Read and write** for `wiki.upsert` and `branch_cleanup`.
   - **Pull requests — Read-only** only when using `branch_cleanup`, for checking merged and open PR state.
5. In this repository, open **Settings → Secrets and variables → Actions → New repository secret**.
6. Name the secret `REPO_REMOTE_TOKEN` and paste the token.
7. Create the Issue label `repo-remote:command`.
8. Optional: create an Actions repository variable named `ALLOWED_ACTORS` containing a JSON array of additional GitHub logins, such as `["alice","octocat"]`. Leave it unset or set it to `[]` for owner-only operation.

GitHub groups repository metadata updates, template-repository toggling, and automatic merged-head-branch deletion under Administration permission. Its [Delete a reference](https://docs.github.com/en/rest/git/refs#delete-a-reference) endpoint requires Contents write, while [List pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests) requires Pull requests read. Wiki operations use the separate Git-backed Wiki repository and require Contents access appropriate to read/write behavior. Contents write is a material increase in credential blast radius even though repo-remote exposes neither arbitrary Contents operations nor arbitrary Wiki Git operations. Keep the token on **Selected repositories**; the checked-in schema, parser, fixed remote construction, filename guards, and workflow remain the narrower policy boundary.

See [SECURITY.md](SECURITY.md) for token rotation, actor authorization, workflow hardening, Wiki safety, and the optional protected-environment setup.

## Security model

This repository may be public, but commands are deliberately constrained:

- only Issues carrying the explicit `repo-remote:command` label are considered;
- the repository owner is authorized by default; additional actors require explicit `ALLOWED_ACTORS` configuration;
- both the Issue author and the account that triggered the current event must be authorized; closed Issues and manual re-runs cannot execute;
- target owner is hard-locked to the control repository owner;
- every command must match the checked-in versioned JSON Schema;
- unknown command keys are rejected;
- only the explicit repository settings, fixed `branch_cleanup: merged`, and `wiki.upsert` / `wiki.read` / `wiki.list` operations are implemented;
- repository PATCH payloads are constructed only from individually allowlisted fields; arbitrary settings objects are never accepted;
- Wiki remote identity is derived exclusively from the validated owner/repository; Issue input cannot provide a URL, remote, branch, or filesystem path;
- Wiki page names reject traversal/path separators and GitHub-problematic filename characters; Wiki content and result size are bounded;
- Git commands use argument arrays with `shell: false`, while Wiki content is written through Node file APIs rather than interpolated into commands;
- malformed commands are rejected before the cross-repository PAT is exposed to a step;
- non-dry-run cleanup is rejected before PAT exposure unless `confirm: true` is present;
- cleanup candidates require exact same-repository merged-PR evidence into the current default at the current branch head, and the destructive boundary is rechecked before deletion;
- default, protected, kept, open-PR, fork-head, unmerged, non-default-base, and advanced/reused branch cases are not deleted;
- dry runs execute without the PAT, and the runtime ignores any accidentally supplied PAT for them;
- token values, Bearer credentials, Basic Git credentials, and Authorization headers are redacted from runtime error logs;
- Issue text is passed to the parser as data, not executed as shell code;
- successful commands are commented on and closed; failures remain open with a link to the Actions run.

## Why Issues?

ChatGPT's connected GitHub tooling and many other agents can create Issues even when a particular GitHub REST write endpoint is not exposed directly. This repository turns that common capability into a small, auditable command queue.

The Issue history is also a useful operation log: every requested operation remains visible and attributable.

## Files

```text
.github/workflows/repo-remote.yml  # authorized Issue → Actions bridge
.github/workflows/ci.yml           # dependency-free parser/security tests
schemas/command-v1.schema.json     # versioned command policy
scripts/command.mjs                # schema + semantic validation
scripts/validate-command-cli.mjs   # validation step without PAT
scripts/apply-command.mjs          # command dispatcher + GitHub REST mutations
scripts/wiki.mjs                   # bounded Git-backed Wiki read/list/upsert runtime
scripts/branch-cleanup.mjs         # pure merged-branch planner + destructive rechecks
scripts/security.mjs               # log redaction
docs/wiki-operations.md            # Wiki protocol, setup, and safety details
SECURITY.md                        # token/actor/workflow security guidance
README.md                          # protocol and setup
```

## Author / design

Designed by 月野テンプレクス with 山田佳江 as a tiny piece of infrastructure for the `yo4e` GitHub toy box.
