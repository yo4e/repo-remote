# repo-remote

A tiny control repository for safely updating GitHub repository metadata through Issues and GitHub Actions.

`repo-remote` is a bridge: an authorized Issue becomes a narrowly scoped command, and GitHub Actions applies that command to another repository owned by `yo4e`.

## What it can change

Only these repository metadata fields are supported:

- `description` — GitHub About description
- `homepage` — GitHub About website URL
- `topics` — GitHub repository topics

It intentionally does **not** support repository deletion, visibility changes, transfers, archiving, renaming, branch operations, or arbitrary GitHub API calls.

## Command format

Create an Issue whose body is JSON:

```json
{
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

`repository` may also be written as `yo4e/Word-Terrarium`. Any owner other than `yo4e` is rejected.

All fields except `repository` are optional, but at least one of `description`, `homepage`, or `topics` must be present.

To validate a command without changing anything:

```json
{
  "repository": "Word-Terrarium",
  "topics": ["creative-coding", "digital-toy"],
  "dry_run": true
}
```

## One-time setup

The standard Actions `GITHUB_TOKEN` is scoped to this repository and cannot administer sibling repositories. `repo-remote` therefore needs one fine-grained personal access token stored as an Actions secret.

1. In GitHub, create a **fine-grained personal access token**.
2. Resource owner: `yo4e`.
3. Repository access: **All repositories** (or select only the repositories you want `repo-remote` to control).
4. Repository permission: **Administration — Read and write**.
5. In this repository, open **Settings → Secrets and variables → Actions → New repository secret**.
6. Name the secret `REPO_REMOTE_TOKEN` and paste the token.

GitHub requires Administration write permission for both updating repository metadata and replacing repository topics.

## Security model

This repository may be public, but commands are deliberately constrained:

- the workflow only runs commands from the repository owner (`yo4e`)
- target owner is hard-locked to `yo4e`
- unknown command keys are rejected
- only `description`, `homepage`, and `topics` are implemented
- the control token is stored only in GitHub Actions Secrets
- Issue text is passed to the parser as data, not executed as shell code
- successful commands are commented on and closed; failures remain open with a link to the Actions run

The token itself has broader repository-administration permission because GitHub groups these metadata endpoints under Administration. The code intentionally exposes only the three operations above.

## Why Issues?

ChatGPT's connected GitHub tooling can create Issues reliably even when a particular GitHub REST write endpoint is not exposed directly. This repository turns that existing capability into a small, auditable command queue.

The Issue history is also a useful operation log: every requested metadata change remains visible and attributable.

## Files

```text
.github/workflows/repo-remote.yml  # Issue → Actions bridge
scripts/apply-command.mjs         # strict validator + GitHub REST calls
README.md                         # protocol and setup
```

## Author / design

Designed by 月野テンプレクス with 山田佳江 as a tiny piece of infrastructure for the `yo4e` GitHub toy box.
