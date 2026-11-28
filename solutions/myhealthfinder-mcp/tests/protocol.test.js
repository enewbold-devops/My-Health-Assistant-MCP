import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { request } from 'node:http';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTopicHttpServer } from '../src/server.js';

async function listen(t, fetchImpl) {
  const server = createTopicHttpServer({ fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return new URL(`http://127.0.0.1:${server.address().port}/mcp`);
}

async function connect(t, url, mode = 'legacy') {
  const client = new Client({ name: 'protocol-test', version: '1.0.0' }, {
    versionNegotiation: { mode }
  });
  await client.connect(new StreamableHTTPClientTransport(url));
  t.after(() => client.close());
  return client;
}

function fixture(url) {
  const topic = { Type: 'Topic', Id: '527', Title: 'Mi tema' };
  const result = { Error: 'False', Language: 'Spanish', Total: 1 };
  if (url.pathname.endsWith('itemlist.json')) {
    result.Items = { Item: [topic] };
  } else {
    result.Resources = { Resource: [{
      ...topic,
      AccessibleVersion: 'https://odphp.health.gov/espanol/myhealthfinder/mi-tema',
      LastUpdate: '1781190340',
      Sections: { section: [{ Title: 'Sección', Content: '<p>Texto original.</p>' }] }
    }] };
  }
  return Response.json({ Result: result });
}

test('a legacy client initializes, discovers exactly two read-only tools and reads the UI resource', async t => {
  const url = await listen(t, () => assert.fail('Discovery made an upstream call'));
  const client = await connect(t, url);
  assert.equal(client.getServerVersion().name, 'myhealthfinder');
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_health_topic', 'list_health_topics']);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.type, 'object');
  }
  const uri = tools[0]._meta.ui.resourceUri;
  const { contents } = await client.readResource({ uri });
  assert.equal(contents[0].uri, uri);
  assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
});

test('a modern client opens a catalog selection from a fresh legacy client', async t => {
  const calls = [];
  const url = await listen(t, upstream => {
    calls.push(upstream);
    return fixture(upstream);
  });
  const browse = await connect(t, url);
  const list = await browse.callTool({ name: 'list_health_topics', arguments: { language: 'es' } });
  const { topics, language } = list.structuredContent;
  const detail = await connect(t, url, { pin: '2026-07-28' });
  const result = await detail.callTool({
    name: 'get_health_topic', arguments: { topicId: topics[0].topicId, language }
  });
  assert.equal(result.structuredContent.topicId, '527');
  assert.equal(result.structuredContent.language, 'es');
  assert.equal(result.structuredContent.status, 'found');
  assert.match(result.structuredContent.lastUpdated, /Z$/);
  assert.doesNotMatch(JSON.stringify(result.structuredContent) + JSON.stringify(result.content), /Texto original/);
  assert.match(JSON.stringify(result._meta.article), /Texto original/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('topicId'), '527');
  assert.equal(calls[1].searchParams.get('lang'), 'es');
});

test('invalid tool arguments and undeclared operations cannot trigger upstream calls', async t => {
  let calls = 0;
  const url = await listen(t, () => { calls++; throw new Error('Unexpected upstream call'); });
  const client = await connect(t, url);
  for (const params of [
    { name: 'list_health_topics', arguments: { limit: 51 } },
    { name: 'list_health_topics', arguments: { language: 'fr' } },
    { name: 'list_health_topics', arguments: { extra: 'private-test-value' } },
    { name: 'get_health_topic', arguments: { topicId: 527 } }
  ]) {
    const result = await client.callTool(params);
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /private-test-value/);
  }
  await assert.rejects(client.callTool({ name: 'get_preventive_recommendations', arguments: {} }));
  assert.equal(calls, 0);
});

test('missing translations and publisher failures have distinct tool results', async t => {
  let available = true;
  const url = await listen(t, () => available
    ? Response.json({ Result: { Error: 'False', Language: 'Spanish', Total: 0 } })
    : new Response('internal diagnostic', { status: 503 }));
  const client = await connect(t, url);
  const params = { name: 'get_health_topic', arguments: { topicId: '30602', language: 'es' } };
  const missing = await client.callTool(params);
  assert.deepEqual(missing.structuredContent, { language: 'es', topicId: '30602', status: 'not_found' });
  available = false;
  const failed = await client.callTool(params);
  assert.equal(failed.isError, true);
  assert.equal(failed._meta.errorCode, 'UPSTREAM_FAILURE');
  assert.doesNotMatch(JSON.stringify(failed), /internal diagnostic/);
});

test('the local route accepts the tunnel hostname and enforces method, origin and body limits', async t => {
  const url = await listen(t, () => assert.fail('An HTTP guard made an upstream call'));
  // Native HTTP preserves the explicit Host a forwarding proxy supplies.
  function requestStatus(method, headers) {
    return new Promise((resolve, reject) => {
      const req = request(url, { method, headers }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
  }
  assert.equal(await requestStatus('GET', { Host: 'myhealthfinder.e-newbold.com' }), 405);
  assert.equal(await requestStatus('GET', { Host: 'myhealthfinder.e-newbold.com', Origin: 'https://chatgpt.com' }), 405);
  assert.equal(await requestStatus('POST', { Host: 'unconfigured.example' }), 403);
  assert.equal(await requestStatus('POST', { Origin: 'https://unconfigured.example' }), 403);
  const body = await fetch(url, { method: 'POST', body: ' '.repeat(32 * 1024 + 1) });
  assert.equal(body.status, 413);
  assert.equal((await fetch(new URL('/other', url))).status, 404);
});

test('the single-process listener bounds concurrent requests and recovers when calls finish', { timeout: 8_000 }, async t => {
  const filled = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  const url = await listen(t, async () => {
    if (++calls === 16) filled.resolve();
    await release.promise;
    return Response.json({ Result: { Error: 'False', Language: 'English', Total: 0 } });
  });
  const client = await connect(t, url);
  const params = { name: 'list_health_topics', arguments: {} };
  const inFlight = Array.from({ length: 16 }, () => client.callTool(params));
  try {
    await filled.promise;
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 429);
    assert.ok(response.headers.get('Retry-After'));
  } finally {
    release.resolve();
    await Promise.all(inFlight);
  }
  assert.equal((await client.callTool(params)).structuredContent.total, 0);
});
