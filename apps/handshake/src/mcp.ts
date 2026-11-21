import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { JsonObject } from "@ternent/concord";
import * as z from "zod/v4";
import type { HandshakeTerms } from "./model.js";

type ToolOperation = () => Promise<JsonObject>;

type Operations = { status: ToolOperation } & (
  | { role: "sender"; propose: ToolOperation }
  | { role: "recipient"; accept: (terms: HandshakeTerms) => Promise<JsonObject> }
);

async function call(operation: ToolOperation): Promise<CallToolResult> {
  try {
    const result = await operation();
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    const message =
      error instanceof Error && !("code" in error) && /^[A-Z][A-Z0-9_]+:/.test(error.message)
        ? error.message
        : "HANDOFF_FAILED: the local operator can check the handoff files";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

export function serveHandshakeMcp(operations: Operations): void {
  serveStdio(() => {
    const server = new McpServer({ name: "ternent-handshake", version: "0.1.0" });
    const noArguments = z.strictObject({});
    server.registerTool(
      "handshake_status",
      {
        description: "Read the verified handoff status and any signed proposal terms.",
        inputSchema: noArguments,
      },
      () => call(operations.status),
    );

    if (operations.role === "sender") {
      server.registerTool(
        "handshake_propose",
        {
          description: "Sign the proposal for the operator-configured artifact and recipient.",
          inputSchema: noArguments,
        },
        () => call(operations.propose),
      );
    } else {
      server.registerTool(
        "handshake_accept",
        {
          description: "Sign acceptance of the exact terms from handshake_status.",
          inputSchema: z.strictObject({ recipientId: z.string(), artifactSha256: z.string() }),
        },
        (terms) => call(() => operations.accept(terms)),
      );
    }
    return server;
  });
}
