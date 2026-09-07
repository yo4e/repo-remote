# GitHub Wiki operations

> **Status: retained implementation, live rollout deferred.**
>
> `wiki.list`, `wiki.read`, and `wiki.upsert` are implemented and tested as a narrow Git-backed operation family, but they are **not part of repo-remote's recommended baseline deployment**. Current use does not justify the additional Contents permission, Selected-repository maintenance, and Git-backed Wiki setup friction. The code and this document are retained so the work is not lost if Wiki automation becomes useful later.

GitHub Wikis are separate Git repositories at the fixed derived remote `https://github.com/<owner>/<repo>.wiki.git`; commands cannot supply a remote URL or filesystem path.

Further Wiki work, live rollout, and possible future GitHub App authentication are tracked as future items in [Issue #4](https://github.com/yo4e/repo-remote/issues/4).

## Supported by the retained implementation

### `wiki.upsert`

Create or replace one Markdown Wiki page.

```json
{
  "version": 1,
  "repository": "example-repo",
  "operation": "wiki.upsert",
  "params": {
    "page": "Architecture",
    "content": "# Architecture\n\n...",
    "message": "Update Architecture wiki"
  }
}
```

`message` is optional. `dry_run: true` validates the command, page name, and content bounds without receiving `REPO_REMOTE_TOKEN` or touching the Wiki.

### `wiki.read`

Read one Markdown page and return its content in the command Issue result comment.

```json
{
  "version": 1,
  "repository": "example-repo",
  "operation": "wiki.read",
  "params": {
    "page": "Architecture"
  }
}
```

### `wiki.list`

List Markdown pages in the Wiki root.

```json
{
  "version": 1,
  "repository": "example-repo",
  "operation": "wiki.list",
  "params": {}
}
```

Read/list commands use the normal validated PAT-bearing execution step so they can also read private repositories when the token can access the target. They are read-only but are not `dry_run` commands.

## Why rollout is deferred

The implementation itself is narrow, but live use still has operational costs:

- Wiki writes require **Contents: Read and write**, which materially broadens the PAT's blast radius compared with metadata-only use;
- Selected-repository PATs must include every Wiki target;
- GitHub Wikis use a separate `.wiki.git` repository and have initialization/setup edge cases;
- current repo-remote usage does not need Wiki automation often enough to justify that friction.

Do not widen a PAT to **All repositories** just to make Wiki use more convenient. If Wiki automation becomes important later, reassess the authentication model first; a GitHub App may then be worth the added setup complexity.

## Page-name safety

Wiki page input is a title, never a path. The retained implementation:

- supports Markdown (`.md`) pages only;
- trims and NFC-normalizes the title;
- converts whitespace runs to `-` for the Wiki filename;
- rejects path separators, traversal-like `..`, hidden-dot filenames, trailing dots, control characters, and GitHub-problematic filename characters (`\\ / : * ? " < > |`);
- writes only a single file directly inside an ephemeral Wiki checkout;
- uses `git ... -- <filename>` argument boundaries rather than shell interpolation.

Page content is written with Node file APIs, never embedded into a shell command. Wiki content is limited to 48,000 UTF-8 bytes and audit output to 60,000 bytes.

## Git remote and credentials

The remote is always derived internally as:

```text
https://github.com/<validated-owner>/<validated-repository>.wiki.git
```

No command field can alter the host, protocol, remote, or path. The token is supplied to Git through process-environment Git configuration for an HTTPS authorization header; it is not placed in the remote URL or command arguments.

If experimenting with this capability, use a fine-grained PAT scoped to **Selected repositories** and only the Contents permission required by the operation. Keep the token only in the `REPO_REMOTE_TOKEN` Actions secret.

## Wiki initialization

GitHub does not expose the Wiki Git repository for cloning until an initial Wiki page exists. If clone reports that the Wiki repository is missing, repo-remote fails with setup guidance instead of attempting another remote.

Initialize once in the target repository:

1. Open the repository's **Wiki** tab.
2. Create and save the first page (for example `Home`).
3. Retry the repo-remote command.

For private repositories, a similar clone failure can also mean the token cannot access the target; verify repository selection and Contents permission.

## Concurrency behavior

Each operation uses an ephemeral checkout. `wiki.upsert` first attempts a normal push. If Git reports a non-fast-forward/fetch-first rejection, repo-remote performs one `pull --rebase` against the cloned Wiki's current branch and retries once. A real content conflict fails closed for human review rather than force-pushing or overwriting history.

## Explicitly out of scope

This implementation does not provide:

- arbitrary Git remotes or URLs;
- arbitrary filesystem paths or subdirectories;
- arbitrary shell commands;
- force push;
- Wiki rename or delete;
- non-Markdown Wiki formats;
- automatic initialization of an uninitialized GitHub Wiki.

`wiki.rename` and `wiki.delete` remain future destructive operations and should receive their own confirmation and security review before implementation. There is no current plan to implement them.
