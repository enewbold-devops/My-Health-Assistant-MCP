import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const SERVER_NAME = "azapp-mcp";
export const SERVER_VERSION = "1.0.0";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // Placeholder read-only tool that proves the end-to-end transport works.
  // Replace with real capabilities designed per the enewbold-mcp-tool-design skill.
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Checks that the MCP server is reachable. Returns the supplied message and the server time.",
      inputSchema: { message: z.string().max(200).default("pong") },
      outputSchema: { message: z.string(), serverTime: z.string() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ message }) => {
      const structuredContent = { message, serverTime: new Date().toISOString() };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  return server;
}
