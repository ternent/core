# Library version intent

Use `pnpm exec changeset add` for changes to the five public libraries. Private
packages are not versioned or tagged.

The enabled version workflow opens a draft PR for unconsumed public changesets or
an exit from prerelease mode. `pnpm release:version` checks npm history, validates
proposed versions, runs Changesets, updates the lockfile and writes
`release-intent.json` with the complete five-library version snapshot and channel.
Review the prerelease state, manifests, changelogs, lockfile and intent together.
That command allocates versions; it does not publish.

Normal releases use stable versions and `latest`. An active Changesets alpha
prerelease uses `next`. Run `pnpm exec changeset pre exit` to prepare the stable
transition; the next version PR removes prerelease suffixes and selects `latest`.
Run `pnpm exec changeset pre enter alpha` before allocating another preview series.
The versioning GitHub App and release trusted publishers require the setup
described in the release contract.

The release planner requires matching committed intent for new package versions.
It freezes the existing tested tarballs, and the publisher never repacks them.
