import assert from 'node:assert/strict';
import test from 'node:test';
import { TopicService } from '../src/domain.js';

function catalog() {
  return {
    Error: 'False', Total: 2, Language: 'English',
    Items: { Item: [
      { Type: 'Topic', Id: '25', Title: 'Current upstream title' },
      { Type: 'Topic', Id: '88888888', Title: 'A newly published title' },
    ] },
  };
}

function article() {
  return {
    Type: 'Topic', Id: '527', Title: 'Título de prueba',
    AccessibleVersion: 'https://odphp.health.gov/espanol/myhealthfinder/categoria/titulo',
    LastUpdate: '1781190340',
    Sections: { section: [{ Title: 'Contenido', Content: '<p>Texto de prueba.</p>' }] },
  };
}

function details(row = article()) {
  return { Error: 'False', Total: 1, Language: 'Spanish', Resources: { Resource: [row] } };
}

const json = result => Response.json({ Result: result });
const serviceFor = result => new TopicService(async () => json(result));
const spanishLookup = { topicId: '527', language: 'es' };

test('pages the live inventory and enriches only IDs found in the matching registry locale', async () => {
  const calls = [];
  const service = new TopicService(async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return json(catalog());
  });
  const first = await service.list({ limit: 1 });
  assert.deepEqual(first, {
    language: 'en', topics: [{ topicId: '25', title: 'Current upstream title', skillId: 'SK-003' }],
    total: 2, nextOffset: 1,
  });
  const second = await service.list({ offset: first.nextOffset });
  assert.deepEqual(second.topics, [{ topicId: '88888888', title: 'A newly published title' }]);
  assert.equal(second.nextOffset, null);
  assert.deepEqual(await service.list({ offset: 30 }), { language: 'en', topics: [], total: 2, nextOffset: null });
  assert.equal(calls.length, 3);
  for (const url of calls) {
    assert.equal(url.origin + url.pathname, 'https://odphp.health.gov/myhealthfinder/api/v4/itemlist.json');
    assert.deepEqual(Object.fromEntries(url.searchParams), { type: 'topic', lang: 'en' });
  }
});

test('returns source metadata and exact localized sections for the presentation adapter', async () => {
  const service = new TopicService(async (url) => {
    assert.equal(url.origin + url.pathname, 'https://odphp.health.gov/myhealthfinder/api/v4/topicsearch.json');
    assert.deepEqual(Object.fromEntries(url.searchParams), { topicId: '527', lang: 'es' });
    return json(details());
  });
  assert.deepEqual(await service.get(spanishLookup), {
    language: 'es', topicId: '527', status: 'found', title: 'Título de prueba',
    sourceUrl: article().AccessibleVersion, lastUpdated: '2026-06-11T15:05:40.000Z',
    sections: [{ title: 'Contenido', content: '<p>Texto de prueba.</p>' }],
  });
});

test('returns an explicit localized empty result without calling another language', async () => {
  let calls = 0;
  const service = new TopicService(async () => {
    calls++;
    return json({ Error: 'False', Total: 0, Language: 'Spanish' });
  });
  assert.deepEqual(await service.get({ language: 'es', topicId: '30602' }),
    { language: 'es', topicId: '30602', status: 'not_found' });
  assert.equal(calls, 1);
});

test('retains the article body when the publisher omits a section heading', async () => {
  const content = '<p>Texto de prueba.</p>';
  for (const heading of [{}, { Title: null }, { Title: '  ' }]) {
    const row = { ...article(), Sections: { section: [{ ...heading, Content: content }] } };
    const found = await serviceFor(details(row)).get(spanishLookup);
    assert.deepEqual(found.sections, [{ title: '', content }]);
  }
  for (const Title of [17, '<b>Quién</b>']) {
    const row = { ...article(), Sections: { section: [{ Title, Content: content }] } };
    await assert.rejects(serviceFor(details(row)).get(spanishLookup), { code: 'INVALID_UPSTREAM' });
  }
});

test('rejects invalid or extra parameters before any fetch', async () => {
  let calls = 0;
  const service = new TopicService(() => { calls++; });
  for (const args of [null, [], { language: 'ES' }, { language: null }, { limit: 0 }, { limit: 51 },
    { limit: '20' }, { offset: -1 }, { offset: 0.5 }, { offset: 10001 }, { age: 30 },
    Object.create({ language: 'es' })]) {
    await assert.rejects(service.list(args), { code: 'INVALID_INPUT' });
  }
  for (const args of [undefined, {}, { topicId: 527 }, { topicId: '0' }, { topicId: '025' },
    { topicId: '12345678901' }, { topicId: '527,25' }, { topicId: '527', url: 'https://example.com' },
    { topicId: '527', language: 'fr' }]) {
    await assert.rejects(service.get(args), { code: 'INVALID_INPUT' });
  }
  assert.equal(calls, 0);
});

test('malformed inventory, duplicate IDs, locale drift and fake empty results fail closed', async () => {
  const original = catalog();
  for (const result of [
    { ...original, Total: '2' }, { ...original, Language: 'Spanish' }, { ...original, Items: null },
    { ...original, Total: 3 }, { ...original, Items: { Item: Array(2).fill(original.Items.Item[0]) } },
    { ...original, Total: 1, Items: { Item: [{ Type: 'Category', Id: '25', Title: 'Unexpected' }] } },
    { ...original, Total: 1, Items: { Item: [{ Type: 'Topic', Id: '25', Title: '<b>Markup</b>' }] } },
    { Total: 0, Error: 'Unexpected', Language: 'English' },
  ]) {
    await assert.rejects(serviceFor(result).list(), { code: 'INVALID_UPSTREAM' });
  }
  await assert.rejects(serviceFor({ Error: 'True' }).list(), { code: 'UPSTREAM_FAILURE' });
});

test('verifies detail identity, locale, last update, official path, and article shape', async () => {
  const invalidUrls = [
    'https://odphp.health.gov.evil.example/espanol/myhealthfinder/tema',
    'https://odphp.health.gov/myhealthfinder/english-article',
    'https://odphp.health.gov/espanol/myhealthfinder/%2E%2E/otra',
    'https://odphp.health.gov/espanol/myhealthfinder/%2Fexternal',
    'https://odphp.health.gov/espanol/myhealthfinder/titulo?destination=other',
    'https://odphp.health.gov/espanol/myhealthfinder/%',
  ];
  for (const change of [
    { Id: '25' }, { Type: 'Category' }, { Title: null }, { LastUpdate: '' }, { Sections: {} },
    { Sections: { section: [null] } },
    ...invalidUrls.map(AccessibleVersion => ({ AccessibleVersion })),
  ]) {
    const service = serviceFor(details({ ...article(), ...change }));
    await assert.rejects(service.get(spanishLookup), { code: 'INVALID_UPSTREAM' });
  }
  for (const change of [{ Total: 0 }, { Language: 'English' },
    { Total: 2, Resources: { Resource: [article(), article()] } }]) {
    await assert.rejects(serviceFor({ ...details(), ...change }).get(spanishLookup), { code: 'INVALID_UPSTREAM' });
  }
});

test('normalizes transport, publisher status, and body errors without exposing diagnostics', async () => {
  const upstreamCases = [
    [() => { throw new Error('private network diagnostic'); }, 'UPSTREAM_FAILURE'],
    [() => { throw new DOMException('private timeout diagnostic', 'TimeoutError'); }, 'UPSTREAM_TIMEOUT'],
    [() => new Response(null, { status: 429 }), 'RATE_LIMITED'],
    [() => new Response(null, { status: 502 }), 'UPSTREAM_FAILURE'],
    [() => Response.redirect('https://example.org'), 'INVALID_UPSTREAM'],
    [() => new Response('<html>'), 'INVALID_UPSTREAM'],
    [() => new Response('{', { headers: { 'Content-Type': 'application/json' } }), 'INVALID_UPSTREAM'],
    [() => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' } }), 'INVALID_UPSTREAM'],
    [() => new Response(' '.repeat(524_289), { headers: { 'Content-Type': 'application/json' } }), 'INVALID_UPSTREAM'],
    [() => new Response('{}', { headers: { 'Content-Type': 'application/json; charset=iso-8859-1' } }), 'INVALID_UPSTREAM'],
    [() => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }), 'INVALID_UPSTREAM'],
  ];
  for (const [fetchImpl, code] of upstreamCases) {
    await assert.rejects(new TopicService(fetchImpl).list(), { code, message: code });
  }
});
