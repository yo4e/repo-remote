# repo-remote

A tiny control repository for safely updating GitHub repository metadata through Issues and GitHub Actions.

`repo-remote` is a bridge: an authorized, explicitly labeled Issue becomes a narrowly scoped command, and GitHub Actions applies that command to another repository owned by the control-repository owner.

## What it can change

Only these repository metadata fields are supported:

- `description` — GitHub About description
- `homepage` — GitHub About website URL
- `topics` — GitHub repository topics

It intentionally does **not** support repository deletion, visibility changes, transfers, archiving, renaming, branch operations, arbitrary GitHub API calls, or arbitrary shell commands.

## Command format

Create an Issue with the label **`repo-remote:command`** whose body is JSON:

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

`repository` may also be written as `OWNER/Word-Terrarium`. Any owner other than the control repository owner is rejected.

`version` is required and must currently be `1`. Unknown keys are rejected. All mutation fields are optional individually, but at least one of `description`, `homepage`, or `topics` must be present.

To validate a command without changing anything:

```json
{
  "version": 1,
  "repository": "Word-Terrarium",
  "topics": ["creative-coding", "digital-toy"],
  "dry_run": true
}
```

Dry runs never receive the cross-repository PAT.

## One-time setup

The standard Actions `GITHUB_TOKEN` is scoped to this repository and cannot administer sibling repositories. `repo-remote` therefore currently needs one fine-grained personal access token stored as an Actions secret.

1. In GitHub, create a **fine-grained personal access token**.
2. Set the resource owner to the account that owns the repositories to control.
3. Prefer **Selected repositories** and grant access only to repositories that `repo-remote` needs to manage. Use broader access only when it is genuinely required.
4. Repository permission: **Administration — Read and write**.
5. In this repository, open **Settings → Secrets and variables → Actions → New repository secret**.
6. Name the secret `REPO_REMOTE_TOKEN` and paste the token.
7. Create the Issue label `repo-remote:command`.
8. Optional: create an Actions repository variable named `ALLOWED_ACTORS` containing a JSON array of additional GitHub logins, such as `["alice","octocat"]`. Leave it unset or set it to `[]` for owner-only operation.

GitHub groups repository metadata updates and topic replacement under Administration permission, so the credential is broader than the command surface. The code and workflow are therefore the policy boundary.

See [SECURITY.md](SECURITY.md) for token rotation, actor authorization, workflow hardening, and the optional protected-environment setup.

## Security model

This repository may be public, but commands are deliberately constrained:

- only Issues carrying the explicit `repo-remote:command` label are considered;
- the repository owner is authorized by default; additional actors require explicit `ALLOWED_ACTORS` configuration;
- target owner is hard-locked to the control repository owner;
- every command must match the checked-in versioned JSON Schema;
- unknown command keys are rejected;
- only `description`, `homepage`, and `topics` are implemented;
- malformed commands are rejected before the cross-repository PAT is exposed to a step;
- dry runs execute without the PAT;
- token values and Authorization headers are redacted from runtime error logs;
- Issue text is passed to the parser as data, not executed as shell code;
- successful commands are commented on and closed; failures remain open with a link to the Actions run.

## Why Issues?

ChatGPT's connected GitHub tooling and many other agents can create Issues even when a particular GitHub REST write endpoint is not exposed directly. This repository turns that common capability into a small, auditable command queue.

The Issue history is also a useful operation log: every requested metadata change remains visible and attributable.

## Files

```text
.github/workflows/repo-remote.yml  # authorized Issue → Actions bridge
.github/workflows/ci.yml           # dependency-free parser/security tests
schemas/command-v1.schema.json     # versioned command policy
scripts/command.mjs                # schema + semantic validation
scripts/validate-command-cli.mjs   # validation step without PAT
scripts/apply-command.mjs          # GitHub REST mutations
scripts/security.mjs               # log redaction
SECURITY.md                        # token/actor/workflow security guidance
README.md                          # protocol and setup
```

## Author / design

Designed by 月野テンプレクス with 山田佳江 as a tiny piece of infrastructure for the `yo4e` GitHub toy box.
