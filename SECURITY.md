# Security

`repo-remote` is a policy boundary around a credential that can modify narrowly allowlisted GitHub repository settings and, when explicitly requested, delete narrowly proven merged branch refs in other repositories. Treat changes to the workflow, command schema, parser/runtime, branch-cleanup planner, token permissions, and security tests as security-sensitive.

A Git-backed Wiki implementation also exists in the repository, but **live Wiki use is currently deferred and is not part of the recommended baseline deployment**. Its security boundary remains documented because the code is retained for possible future use.

## Authentication and minimum permissions

Prefer a fine-grained personal access token with access to only the repositories that `repo-remote` must control. Grant only the permissions required by operations you actually enable:

- **Administration: Read and write** for description, homepage, topics, template-setting changes, and `delete_branch_on_merge`;
- **Contents: Read and write** plus **Pull requests: Read-only** only when using `branch_cleanup`;
- optional/deferred Wiki use requires the Contents permissions described in [docs/wiki-operations.md](docs/wiki-operations.md).

`delete_branch_on_merge` uses GitHub's allowlisted Update-a-repository endpoint and does not directly delete a ref, so that setting does not require Contents write by itself.

Store the token as the Actions secret `REPO_REMOTE_TOKEN`. Do not place it in Issues, repository variables, workflow inputs, comments, artifacts, or source files. Prefer a short practical expiry, rotate it periodically, and revoke it immediately if exposure is suspected. Keep **Selected repositories** rather than widening the token to **All repositories** merely to reduce maintenance friction.

A GitHub App is a future authentication option, not unfinished core work. Installation tokens can offer a smaller and more revocable blast radius than a long-lived PAT, but App registration, installation, key handling, and token-minting logic add meaningful setup and maintenance cost. Revisit this only if repo-remote grows to manage enough repositories or users that the PAT model becomes operationally awkward.

## Who may issue commands

A command is considered only when the Issue has the label `repo-remote:command`.

Both the Issue author and the account that triggered the current Issue event must be either:

1. the control repository owner, or
2. explicitly listed in the Actions variable `ALLOWED_ACTORS`.

Requiring both prevents an unauthorized collaborator from editing or labeling an authorized user's command Issue and causing the changed packet to execute. Closed Issues are rejected, and manual workflow re-runs are rejected so an old command packet cannot be executed again outside a fresh authorized Issue event.

`ALLOWED_ACTORS` is a JSON array of GitHub logins, for example:

```text
["alice","octocat"]
```

Leave it unset or use `[]` for owner-only operation. Invalid configuration fails closed.

## Command validation

Commands use the versioned schema in `schemas/command-v1.schema.json` and must include `"version": 1`. Unknown keys are rejected.

Before schema validation proceeds, the raw Issue body is limited to **131,072 UTF-8 bytes** and parsed JSON is limited to **16 levels of depth** and **512 JSON value nodes**. These global guards complement field-specific limits.

Repository-setting PATCH payloads are built only from individually allowlisted fields. The parser also enforces semantic checks including owner matching, allowed homepage protocols, safe branch `keep` entries, standalone cleanup commands, and explicit `confirm: true` for non-dry-run cleanup.

No command can supply an arbitrary REST path, HTTP method, shell command, Git remote, ref, or filesystem path.

## Merged-branch cleanup boundary

`branch_cleanup` supports only `mode: "merged"`. Branch names supplied by the Issue are used only as a validated `keep` list and can never authorize deletion.

A candidate is eligible only when all of these facts hold:

- it is not the current default branch, protected, or in `keep`;
- it has no open PR whose head repository and branch exactly identify that branch in the target repository;
- GitHub records a PR with `merged_at`, an exact same-repository head, the current default as base, and a PR head SHA equal to the current branch SHA.

The SHA equality prevents a branch name that was reused or advanced after merge from authorizing deletion of newer commits. Before each DELETE, repo-remote fetches the relevant evidence again, checks open PRs again, resolves the current default again, and fetches the current branch head/protection state again. If any fact changed, the branch is skipped.

Git ancestry, branch-name similarity, fork PRs, closed-unmerged PRs, merges into non-default bases, tags, arbitrary refs, explicit PR-less deletions, wildcards, prefixes, and age rules are never deletion evidence.

For routine future branch hygiene, prefer `delete_branch_on_merge: true` over repeated cleanup commands.

## Deferred Wiki boundary

The retained Wiki implementation supports only `wiki.upsert`, `wiki.read`, and `wiki.list`. It is intentionally **not promoted as part of the stable core** because live Git-backed Wiki use requires additional Contents access and repository-selection maintenance for limited current benefit.

If it is used experimentally, the remote is constructed exclusively from the validated owner/repository as:

```text
https://github.com/<owner>/<repo>.wiki.git
```

Issue input cannot provide or override a Git remote, URL, host, protocol, filesystem path, or branch. Page names are normalized to one root-level Markdown file and traversal/path separators are rejected. Content is bounded, Git runs without a shell, and Wiki content is written through Node file APIs rather than interpolated into commands.

`wiki.rename` and `wiki.delete` are not implemented. Live rollout, further Wiki work, and any future GitHub App-based authentication remain deferred in Roadmap Issue #4.

See [docs/wiki-operations.md](docs/wiki-operations.md) for the retained implementation details.

## Secret handling and audit evidence

The workflow captures bounded audit evidence and validates the Issue body before the step that can receive `REPO_REMOTE_TOKEN`. Dry runs do not receive the PAT, and the runtime deliberately discards an accidentally supplied PAT for dry-run execution.

Every run records a SHA-256 fingerprint of the raw Issue body and its UTF-8 byte length. Successful comments use validated target/operation metadata; failure comments use only bounded, syntactically safe unvalidated hints where available. The full command body, Authorization material, raw API responses, and Git credential configuration are not copied into the audit comment.

Runtime errors are reported without stack traces. Token values, Bearer credentials, Basic credentials used by Git HTTPS auth, and Authorization header contents are redacted before log output.

## Workflow hardening

The command workflow:

- listens only to Issue events;
- requires the explicit `repo-remote:command` label;
- authorizes both the Issue creator and the current event actor before privileged execution;
- refuses closed Issues and manual re-runs of old command events;
- uses minimal `GITHUB_TOKEN` permissions (`contents: read`, `issues: write`);
- captures request evidence before validation without receiving the cross-repository PAT;
- never exposes the cross-repository PAT to pull-request workflows;
- validates before the PAT-bearing step;
- does not provide the PAT to dry runs;
- validates destructive confirmation before the PAT-bearing step;
- uses per-Issue concurrency and a short job timeout.

For higher-risk installations, place `REPO_REMOTE_TOKEN` in a protected GitHub Environment with required reviewers. This is optional because it adds a human approval gate to every real mutation.

## Repository policy and supply-chain controls

The repository checks in `.github/CODEOWNERS` coverage for the primary policy boundary. CODEOWNERS records review ownership but does not enforce review by itself; enforcement depends on branch-protection or ruleset settings.

Recommended protection for `main` is:

- require pull requests for non-trivial code/policy changes;
- require normal CI before merge;
- disable force pushes;
- disable branch deletion;
- require Code Owner review only when an independent reviewer is actually available.

For an owner-only repository, forcing Code Owner approval can make the rule impossible to satisfy. In that case, keep CODEOWNERS as documentation/routing without enabling an unsatisfiable approval rule.

Additional checked-in controls:

- third-party Actions are pinned to full commit SHAs;
- a regression test rejects mutable `uses:` refs;
- Dependabot checks the `github-actions` ecosystem weekly;
- CodeQL analyzes the JavaScript codebase on main/PR activity and weekly;
- CI runs syntax and security/parser tests.

OpenSSF Scorecard is intentionally not enabled by default. Reconsider it only if broader distribution or external consumers make a published score useful enough to justify another workflow and permissions surface.

Repository-host settings are distinct from checked-in policy and must be verified separately by the repository owner.

## Operational risks and maintenance

Each copy of repo-remote runs in its own repository and GitHub Actions account. A template/copy does not inherit the original repository's `REPO_REMOTE_TOKEN`.

Public Issue traffic can still create webhook/workflow evaluation and notification noise even when authorization prevents privileged execution. The execution gates bound privileged work, not total public event volume; use repository moderation/settings if spam becomes material.

The current maintenance posture is deliberately narrow: new operations should be added only for recurring needs and must receive their own validation, authorization, audit behavior, tests, and security review.

## Scope boundaries

### Stable core

- repository description
- homepage
- topics
- template-setting toggle
- `delete_branch_on_merge`
- fixed merged-branch cleanup

### Retained but deferred

- `wiki.upsert`
- `wiki.read`
- `wiki.list`

### Not supported

- repository deletion
- visibility changes
- transfers
- archive/unarchive
- repository rename
- arbitrary branch deletion
- user-selected refs
- branch-protection/ruleset changes
- tags or arbitrary ref updates
- arbitrary Contents operations
- arbitrary REST paths
- arbitrary Git remotes
- arbitrary shell execution
- force pushes
- Wiki rename/delete
- arbitrary Wiki filesystem paths

## Reporting a vulnerability

Do not include secrets or exploit credentials in a public Issue. If a report would expose sensitive material, rotate or revoke the affected credential first and use a private reporting channel supported by the repository owner.
