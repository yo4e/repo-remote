# Contributing

Thanks for helping improve `repo-remote`.

## Development

Requirements:

- Node.js 20+

Run the local checks before opening a pull request:

```bash
npm run check
npm test
```

## Security-sensitive scope

`repo-remote` is intentionally a narrow policy boundary around privileged GitHub operations. Changes in these areas deserve extra review:

- `.github/workflows/repo-remote.yml`
- `schemas/command-v1.schema.json`
- `scripts/command.mjs`
- `scripts/apply-command.mjs`
- `scripts/branch-cleanup.mjs`
- `scripts/wiki.mjs`
- `scripts/security.mjs`

Do not add arbitrary REST paths, arbitrary shell execution, arbitrary Git remotes, arbitrary filesystem paths, or secret-printing behavior.

## Release process

Use semantic versioning for tagged releases. Update `CHANGELOG.md` for user-visible changes and bump `package.json` when preparing a release.
