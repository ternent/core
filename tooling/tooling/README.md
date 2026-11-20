# @ternent/tooling

Portable ESM package profiles and artifact validation for Ternent's tooling pilot.

Install the exact tested `vite-plus` and TypeScript peers alongside this package.
Import profile factories from `@ternent/tooling/config` and extend the published
`@ternent/tooling/tsconfig/library.json`, `node.json`, or `vue.json` presets.
Vue profiles additionally install their declared optional plugin peers.

`ternent-tooling validate .` checks the manifest before building.
`ternent-tooling validate . --built` checks output paths, declarations, dependencies,
and executable bins. Final release proof also installs the exact tarball externally.

Tooling implementation and public declarations ship directly, so loading a config
never requires building the package that defines it. No runtime product depends on it.
