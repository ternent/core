# Library version intent

Use `pnpm exec changeset add` for changes to the five public libraries. UI and
Workspace are outside this release; private packages are not versioned or tagged.

Before the first alpha version PR, review the actual npm version history and run
`pnpm exec changeset pre enter alpha`. Commit the resulting prerelease state with
the intended changesets. `pnpm release:version` checks proposed versions against
the registry, runs Changesets and updates the lockfile, then writes
`release-intent.json` with the complete five-library version snapshot. Review and
commit those files together. That command allocates versions; it does not publish.

The release planner requires matching committed intent for new package versions.
It freezes the existing tested tarballs, and the publisher never repacks them.
See the [release contract](../docs/engineering/release-and-deployment.md).
