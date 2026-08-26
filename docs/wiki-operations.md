# GitHub Wiki operations

`repo-remote` supports a narrow Git-backed Wiki operation family. GitHub Wikis are separate Git repositories at the fixed derived remote `https://github.com/<owner>/<repo>.wiki.git`; commands cannot supply a remote URL or filesystem path.

## Supported operations

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

Read/list commands use the normal validated PAT-bearing execution step so they also work for private repositories when the token can access the target. They are read-only but are not `dry_run` commands. Like other successful commands, their Issues are used as the audit/result record and then closed.

## Page-name safety

Wiki page input is a title, never a path. `repo-remote`:

- supports Markdown (`.md`) pages only in this first implementation;
- trims and NFC-normalizes the title;
- converts whitespace runs to `-` for the Wiki filename;
- rejects path separators, traversal-like `..`, hidden-dot filenames, trailing dots, control characters, and GitHub's documented filename-problem characters: `\\ / : * ? " < > |`;
- writes only a single file directly inside an ephemeral Wiki checkout;
- uses `git ... -- <filename>` argument boundaries rather than shell interpolation.

Page content is written with Node file APIs, never embedded into a shell command. Wiki content is limited to 48,000 UTF-8 bytes and audit output to 60,000 bytes.

## Git remote and credentials

The remote is always derived internally as:

```text
https://github.com/<validated-owner>/<validated-repository>.wiki.git
```

No command field can alter the host, protocol, remote, or path. The token is supplied to Git through process environment Git configuration for an HTTPS authorization header; it is not placed in the remote URL or command arguments.

Use a fine-grained PAT scoped to **Selected repositories**. Wiki writes require repository **Contents: Read and write** access to the target. Keep the token only in the `REPO_REMOTE_TOKEN` Actions secret.

## Wiki initialization

GitHub does not expose the Wiki Git repository for cloning until an initial Wiki page exists. If clone reports that the Wiki repository is missing, `repo-remote` fails with setup guidance instead of attempting to create an arbitrary remote or falling back to another target.

Initialize once in the target repository:

1. Open the repository's **Wiki** tab.
2. Create and save the first page (for example `Home`).
3. Retry the repo-remote command.

For private repositories, a similar clone failure can also mean the token cannot access the target; verify repository selection and Contents permission.

## Concurrency behavior

Each operation uses an ephemeral checkout. `wiki.upsert` first attempts a normal push. If Git reports a non-fast-forward/fetch-first rejection, repo-remote performs one `pull --rebase` against the cloned Wiki's current branch and retries the push once. A real content conflict fails closed for human review rather than force-pushing or overwriting history.

## Explicitly out of scope

This implementation does not provide:

- arbitrary Git remotes or URLs;
- arbitrary filesystem paths or subdirectories;
- arbitrary shell commands;
- force push;
- Wiki rename or delete;
- non-Markdown Wiki formats;
- automatic initialization of an uninitialized GitHub Wiki.

`wiki.rename` and `wiki.delete` remain future destructive operations and should receive their own confirmation and security review before implementation.
