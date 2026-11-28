import { createServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { TopicService } from './domain.js';
import { presentList, presentTopic, registerTopicView, topicToolMeta } from './presentation.js';

const publicHost = 'myhealthfinder.e-newbold.com';
const bodyBytes = 32 * 1024;
const language = z.enum(['en', 'es']);
const topicId = z.string().regex(/^[1-9][0-9]{0,9}$/);
const offset = z.int().min(0).max(10_000);
const listInput = z.strictObject({
  language: language.default('en'),
  offset: offset.default(0),
  limit: z.int().min(1).max(50).default(20)
}, { error: 'Use only language, offset and limit.' });
const topicInput = z.strictObject({
  language: language.default('en'),
  topicId: topicId.describe('Official topic ID from the catalog for the requested language.')
}, { error: 'Use only topicId and language.' });
const listOutput = z.strictObject({
  language,
  topics: z.array(z.strictObject({
    topicId,
    title: z.string().min(1),
    skillId: z.string().optional()
  })).max(50),
  total: z.int().nonnegative(),
  nextOffset: offset.nullable()
});
// The object root is compatible with both modern and 2025 MCP clients.
const topicOutput = z.strictObject({
  language,
  topicId,
  status: z.enum(['found', 'not_found']),
  title: z.string().min(1).optional(),
  sourceUrl: z.url().optional(),
  lastUpdated: z.iso.datetime().optional()
}).refine(topic => ['title', 'sourceUrl', 'lastUpdated']
  .every(key => (topic[key] !== undefined) === (topic.status === 'found')));
const annotations = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true
};
const publicErrors = new Map([
  ['INVALID_INPUT', 'Check the topic ID, language and paging arguments.'],
  ['UPSTREAM_TIMEOUT', 'MyHealthfinder did not respond in time.'],
  ['RATE_LIMITED', 'MyHealthfinder is busy. Try again later.'],
  ['UPSTREAM_FAILURE', 'MyHealthfinder is temporarily unavailable.'],
  ['INVALID_UPSTREAM', 'The publisher returned an unverifiable response.']
]);

/** Keep transport failures and upstream diagnostics out of tool results. */
async function runTool(operation) {
  try {
    return await operation();
  } catch (error) {
    const code = publicErrors.has(error?.code) ? error.code : 'INTERNAL_ERROR';
    return {
      isError: true,
      content: [{ type: 'text', text: publicErrors.get(code) ?? 'The topic service could not complete this request.' }],
      _meta: { errorCode: code }
    };
  }
}

/** Create a fresh MCP instance for each exchange. Only the public topic service is shared. */
function createTopicServer(service) {
  const server = new McpServer({ name: 'myhealthfinder', title: 'MyHealthfinder', version: '1.0.0' }, {
    instructions: 'Browse public MyHealthfinder topics in English or Spanish. Pass the official topicId and requested language into get_health_topic. Use the publisher view or official link for article text. Ask before switching languages when a translation is unavailable.',
    maxToolInputElements: 8,
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false } }
  });
  server.registerTool('list_health_topics', {
    title: 'List health topics',
    description: 'Browse a page of official MyHealthfinder topic IDs and titles in English or Spanish. Start at offset 0. Use nextOffset for the next page, and pass the chosen ID and language to get_health_topic.',
    inputSchema: listInput, outputSchema: listOutput, annotations, _meta: topicToolMeta
  }, input => runTool(async () => presentList(await service.list(input))));
  server.registerTool('get_health_topic', {
    title: 'Get a health topic',
    description: 'Open one official MyHealthfinder topic by ID in the requested language. Use the source link or view for the article, publisher attribution, and last update. An unavailable topic returns not_found for that language.',
    inputSchema: topicInput, outputSchema: topicOutput, annotations, _meta: topicToolMeta
  }, input => runTool(async () => presentTopic(await service.get(input))));
  registerTopicView(server);
  return server;
}

/** Accept direct loopback traffic and the user-selected Cloudflare hostname. */
function allowedRequest(request) {
  const port = request.socket.localPort;
  const host = request.headers.host?.toLowerCase();
  const hostAllowed = [
    'localhost', '127.0.0.1', `localhost:${port}`, `127.0.0.1:${port}`,
    publicHost, `${publicHost}:443`
  ].includes(host);
  const origin = request.headers.origin;
  return hostAllowed && (origin === undefined || [
    `http://localhost:${port}`, `http://127.0.0.1:${port}`, `https://${publicHost}`,
    'https://chatgpt.com'
  ].includes(origin));
}

/** Build the local Node HTTP listener. Inject fetch for repeatable offline protocol tests. */
export function createTopicHttpServer({ fetchImpl = globalThis.fetch } = {}) {
  const service = new TopicService(fetchImpl);
  const handler = createMcpHandler(() => createTopicServer(service), {
    legacy: 'stateless', maxRequestBodySize: bodyBytes, maxSubscriptions: 0
  });
  const serveMcp = toNodeHandler(handler, { maxRequestBodySize: bodyBytes });
  let active = 0;
  let requests = 0;
  let windowStart = performance.now();
  const httpServer = createServer({
    headersTimeout: 10_000, requestTimeout: 15_000, connectionsCheckingInterval: 1_000
  }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!allowedRequest(req)) {
      res.writeHead(403).end();
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    if (performance.now() - windowStart >= 60_000) {
      requests = 0;
      windowStart = performance.now();
    }
    if (active >= 16 || requests >= 120) {
      res.writeHead(429, { 'Retry-After': '60' }).end();
      return;
    }
    active++;
    requests++;
    try {
      await serveMcp(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    } finally {
      active--;
    }
  });
  httpServer.once('close', () => { void handler.close(); });
  return httpServer;
}
