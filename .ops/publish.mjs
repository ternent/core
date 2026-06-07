import shell from "shelljs";

const packagesToPublish = [
  "../packages/armour",
  "../packages/identity",
  "../packages/ui",
  "../packages/utils",
];

let i = 0;
for (; i < packagesToPublish.length; i++) {
  const { version, name } = (
    await import(`${packagesToPublish[i]}/package.json`, { with: { type: "json" } })
  ).default;

  const fullChangelog = shell
    .exec(
      `gh pr list -B "main" -s merged -H changeset-release/"main" --json body --jq '.[].body' -L 1`,
      { silent: true },
    )
    .toString();

  const changelog = fullChangelog?.split(`## ${name}@${version}`)[1]?.split("## ")[1];

  if (changelog) {
    shell.exec(
      `gh release create "${name}-${version}" -t "${name}-${version}" -n "${name}-${version}" -n "${changelog}"`,
      { silent: true },
    );
  }
}
