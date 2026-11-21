# Ternent handshake pilot

Two agents sign the same artifact handoff in a private Concord document. The local
operator releases the artifact after verification. An invited reviewer can inspect
the receipt offline after both sessions end.

## Run one handoff

From the repository root, build the CLI and its workspace dependencies.

```sh
pnpm install --frozen-lockfile
pnpm exec vp run --filter @ternent/app-handshake build-ready
cli="$PWD/apps/handshake/dist/cli.js"
pilot_dir="$(mktemp -d)"
handoff="$pilot_dir/handoff"
printf 'Pilot artifact\n' > "$pilot_dir/artifact.txt"
node "$cli" init "$handoff" "$pilot_dir/artifact.txt"
```

Use two sequential Codex sessions with separate signer keys. Each session starts
its own local stdio server. The sender has `handshake_status` and `handshake_propose`.
The recipient has `handshake_status` and `handshake_accept`, which takes the exact
`recipientId` and `artifactSha256` reported in the proposal. Use the operator's Codex
login and disposable artifact bytes for this smoke run.
The approval overrides apply to the two named tools in each invocation.

```sh
codex exec --ephemeral --ignore-user-config --skip-git-repo-check \
  --sandbox read-only --cd "$pilot_dir" \
  -c 'mcp_servers.handshake.command="node"' \
  -c "mcp_servers.handshake.args=[\"$cli\",\"mcp\",\"$handoff\",\"sender\"]" \
  -c 'mcp_servers.handshake.required=true' \
  -c 'mcp_servers.handshake.tools.handshake_status.approval_mode="approve"' \
  -c 'mcp_servers.handshake.tools.handshake_propose.approval_mode="approve"' \
  'Call handshake_status, then call handshake_propose using the handshake MCP server.'

codex exec --ephemeral --ignore-user-config --skip-git-repo-check \
  --sandbox read-only --cd "$pilot_dir" \
  -c 'mcp_servers.handshake.command="node"' \
  -c "mcp_servers.handshake.args=[\"$cli\",\"mcp\",\"$handoff\",\"recipient\"]" \
  -c 'mcp_servers.handshake.required=true' \
  -c 'mcp_servers.handshake.tools.handshake_status.approval_mode="approve"' \
  -c 'mcp_servers.handshake.tools.handshake_accept.approval_mode="approve"' \
  'Call handshake_status, then accept the proposal using its exact recipientId and artifactSha256.'
```

Open the signed receipt with the invited reviewer's key. The optional final argument
is a trusted snapshot the reviewer previously saved. Release checks the saved proposal
and any supplied later snapshot, then writes the exact verified artifact bytes to stdout.

```sh
node "$cli" verify "$handoff/receipt.json" "$handoff/reviewer.key" "$handoff/proposal.json"
node "$cli" release "$handoff" "$handoff/receipt.json"
```

Keep the source artifact and all three seed files under local operator control.
The reviewer needs `receipt.json` and their own key. They can also keep a trusted
earlier snapshot to check ancestry and a later head to detect rollback or divergence.
The terms are encrypted for the document members. Same-machine file access is within
the operator's trust boundary.

The CLI publishes each stage once. If two processes sign competing candidates, the
published stage stays in place and the other snapshot is kept under `.candidate-*`
in the handoff directory for inspection.

`pnpm --filter @ternent/app-handshake check` runs the package checks and the built
CLI smoke. The smoke uses the official MCP client with separate child processes and
disposable keys. It exercises verification, rejected acceptance, and release failures
without a model account.
