# Security

`repo-remote` is a policy boundary around a credential that can modify repository metadata and delete narrowly proven branch refs in other repositories. Treat configuration changes to the workflow, command schema, parser, branch-cleanup planner, and token permissions as security-sensitive.

## Authentication and minimum permissions

Prefer a fine-grained personal access token with access to only the repositories that `repo-remote` must control. Grant only the permissions required by the operations you enable:

- **Administration: Read and write** for supported repository metadata and template-setting changes
- **Contents: Read and write** for branch listing and the Git ref deletion endpoint
- **Pull requests: Read-only** for merged/open PR evidence

GitHub documents Contents write as the required permission for [Delete a reference](https://docs.github.com/en/rest/git/refs#delete-a-reference), Contents read for [List branches](https://docs.github.com/en/rest/branches/branches#list-branches), and Pull requests read for [List pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests). Contents write can modify substantially more repository state than repo-remote exposes. Keep **Selected repositories** as the token's repository access, and treat the schema, parser, pure candidate planner, derived endpoint construction, and workflow gates as the narrower allowlist. No arbitrary Contents operation, ref, or REST path is accepted.

Store the token as the Actions secret `REPO_REMOTE_TOKEN`. Do not place it in Issues, repository variables, workflow inputs, comments, artifacts, or source files. Rotate or revoke it immediately if exposure is suspected.

A GitHub App should be preferred in the future when its setup cost is justified, because installation tokens can provide a smaller and more revocable blast radius than a long-lived PAT.

## Who may issue commands

A command is considered only when the Issue has the label `repo-remote:command`.

Both the Issue author and the account that triggered the current Issue event must be either:

1. the control repository owner, or
2. explicitly listed in the repository Actions variable `ALLOWED_ACTORS`.

Requiring both prevents an unauthorized collaborator from editing or labeling an authorized user's command Issue and causing that changed packet to execute. Closed Issues are also rejected so the audit trail cannot be re-executed by later edits or label changes. Manual workflow re-runs are rejected as well; retry a failed command by correcting or relabeling the open Issue so a fresh event creates a new run.

`ALLOWED_ACTORS` is a JSON array of GitHub logins, for example:

```text
["alice","octocat"]
```

Leave the variable unset or set it to `[]` to keep the default owner-only policy. Invalid JSON fails closed because the workflow condition cannot authorize the job.

Do not use the label as the only authorization mechanism. The actor allowlist is an independent gate.

## Command validation

Commands use the versioned schema in `schemas/command-v1.schema.json` and must include `"version": 1`. Unknown keys are rejected. The runtime validator intentionally supports only the JSON Schema keywords used by the checked-in schema and refuses unsupported schema keywords, keeping the policy surface small and dependency-free.

The parser also enforces semantic checks that are awkward to express safely in the schema, including owner matching, allowed homepage protocols, safe `keep` entries, standalone cleanup commands, and explicit `confirm: true` for non-dry-run cleanup. Missing confirmation therefore fails in the PAT-free validation step.

## Merged-branch cleanup boundary

`branch_cleanup` supports only `mode: "merged"`. Branch names from the Issue are used only as a validated `keep` list and can never authorize deletion. Candidate branch names come from GitHub's current branch listing, and the deletion endpoint is constructed internally as a URL-encoded `refs/heads/<candidate>` path.

A candidate is eligible only when all of these facts hold:

- it is not the current default branch, protected, or in `keep`;
- it has no open PR whose `head.repo.full_name` and `head.ref` exactly identify that branch in the target repository;
- GitHub records a PR with `merged_at`, an exact same-repository head, the current default as base, and a PR head SHA equal to the current branch SHA.

The SHA equality prevents a merged branch name that was reused or advanced after merge from authorizing deletion of newer commits. Before each DELETE, repo-remote fetches the PR evidence again, checks open PRs again, resolves the current default again, and fetches the current branch head/protection state again. If any fact changed, the branch is skipped. The GitHub endpoint also refuses default-branch deletion, providing a final server-side guard against the unavoidable race between the last check and DELETE.

Git ancestry, branch-name similarity, fork PRs, closed-unmerged PRs, merges into non-default bases, tags, arbitrary refs, explicit PR-less deletions, wildcards, prefixes, and age rules are never deletion evidence. Planning is bounded to 200 current branches and 5,000 PR records, and the Issue audit report is bounded to 60,000 bytes; larger operations fail closed before deletion.

## Secret handling

The workflow validates the Issue body in a step that does not receive `REPO_REMOTE_TOKEN`. Dry runs also execute without the PAT, and the runtime deliberately discards an accidentally supplied PAT for every dry run. Branch-cleanup dry runs use only public GitHub reads, so a target that is not publicly readable fails rather than receiving the PAT. Only a validated, non-dry-run command reaches the mutation step where the PAT is present.

Runtime errors are reported without stack traces. Token values, Bearer credentials, and Authorization header contents are redacted before log output. Metadata success comments contain validated targets and operation fields; cleanup success comments add bounded deleted/candidate/skipped branch names and fixed skip reasons, never raw API responses.

## Workflow hardening

The command workflow:

- listens only to Issue events;
- requires the explicit `repo-remote:command` label;
- authorizes both the Issue creator and the current event actor before the job runs;
- refuses to execute closed Issues or manual re-runs of an old command event;
- uses minimal `GITHUB_TOKEN` permissions (`contents: read`, `issues: write`);
- never exposes the cross-repository PAT to pull-request workflows;
- validates before the PAT-bearing step;
- does not provide the PAT to dry runs, and validates destructive confirmation before the PAT-bearing step;
- uses a per-Issue concurrency group and a short job timeout.

For higher-risk installations, configure a protected GitHub Environment with required reviewers and move `REPO_REMOTE_TOKEN` to that environment. This is optional because it adds a human approval gate to every real mutation.

## Scope boundaries

The current release supports repository description, homepage, topics, template-setting toggles, and only the fixed merged-branch cleanup described above. It does not accept arbitrary REST paths, shell commands, git remotes, repository deletion, visibility changes, transfers, arbitrary branch deletion, user-selected refs, branch protection/ruleset changes, ref updates, tags, or arbitrary Contents operations.

Wiki operations are not implemented yet. When they are added, they must derive the remote exclusively from the validated owner/repository, normalize page filenames, reject traversal and remote URLs, avoid shell interpolation for page contents, and impose explicit page-size limits before any Wiki write capability is enabled.

## Reporting a vulnerability

Do not include secrets or exploit credentials in a public Issue. If a report would expose sensitive material, rotate/revoke the affected credential first and use a private reporting channel supported by the repository owner.
