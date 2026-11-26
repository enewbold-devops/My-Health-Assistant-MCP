import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./app.js";

describe("MCP server over Streamable HTTP", () => {
  let baseUrl: string;
  let httpServer: Server;

  before(async () => {
    httpServer = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => httpServer.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  after(() => {
    httpServer.closeAllConnections();
    httpServer.close();
  });

  it("reports healthy", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  it("lists and calls the ping tool", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ["ping"]);

      const result = await client.callTool({ name: "ping", arguments: { message: "hello" } });
      const content = result.structuredContent as { message: string; serverTime: string };
      assert.equal(content.message, "hello");
      assert.ok(!Number.isNaN(Date.parse(content.serverTime)));
    } finally {
      await client.close();
    }
  });

  it("rejects invalid tool input", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    try {
      const outcome = await client
        .callTool({ name: "ping", arguments: { message: "x".repeat(201) } })
        .catch((e: unknown) => e);
      assert.ok(outcome instanceof Error || (outcome as { isError?: boolean }).isError === true);
    } finally {
      await client.close();
    }
  });

  it("does not allow GET or DELETE on /mcp in stateless mode", async () => {
    assert.equal((await fetch(`${baseUrl}/mcp`)).status, 405);
    assert.equal((await fetch(`${baseUrl}/mcp`, { method: "DELETE" })).status, 405);
  });
});
