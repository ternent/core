# Library version intent

Use `pnpm exec changeset add` for changes to the five public libraries. UI and
Workspace are outside this release; private packages are not versioned or tagged.

The enabled version workflow opens a draft PR for unconsumed public changesets.
`pnpm release:version` checks npm history before entering alpha mode on the first
run, validates proposed versions, runs Changesets, updates the lockfile and writes
`release-intent.json` with the complete five-library version snapshot. Review the
prerelease state, manifests, changelogs, lockfile and intent together. That command
allocates versions; it does not publish. The versioning GitHub App and release
trusted publishers require the setup described in the release contract.

The release planner requires matching committed intent for new package versions.
It freezes the existing tested tarballs, and the publisher never repacks them.
See the [release contract](../docs/engineering/release-and-deployment.md).
