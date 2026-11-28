import assert from "node:assert/strict";
import test from "node:test";
import { presentList, presentTopic, registerTopicView, topicToolMeta } from "../src/presentation.js";

const detail = {
  topicId: "527", language: "en", status: "found", title: "Official title",
  sourceUrl: "https://odphp.health.gov/myhealthfinder/example",
  lastUpdated: "2026-06-11T12:00:00.000Z"
};

test("both tools use a registered self-contained MCP Apps resource", () => {
  let registration;
  registerTopicView({ registerResource(...args) { registration = args; } });
  const [, uri, descriptor, read] = registration;
  assert.equal(uri, topicToolMeta.ui.resourceUri);
  const [resource] = read().contents;
  assert.equal(resource.uri, uri);
  assert.equal(resource.mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(resource._meta.ui.csp, { connectDomains: [], resourceDomains: ["https://odphp.health.gov"] });
  assert.deepEqual(resource._meta, descriptor._meta);
  assert.match(resource.text, /ui\/initialize/);
  assert.match(resource.text, /ui\/notifications\/tool-result/);
  assert.match(resource.text, /<a href="https:\/\/odphp.health.gov\/myhealthfinder"[^>]*><img alt="MyHealthfinder"/);
});

test("catalog results carry the locale and selectable IDs through to the model", () => {
  const page = { language: "es", topics: [{ topicId: "527", title: "Tema [1] *" }], total: 103, nextOffset: 1 };
  const result = presentList(page);
  assert.deepEqual(result.structuredContent, page);
  assert.match(result.content[0].text, /1 de 103/);
  assert.ok(result.content[0].text.includes("\n\n    527 — Tema [1] *\n\n"));
  assert.match(result.content[0].text, /language=es y offset=1/);
  assert.doesNotMatch(presentList({ ...page, nextOffset: null }).content[0].text, /offset=/);
  assert.match(result.content[0].text, /MyHF\.svg/);
});

test("article content is only sent to the component as inert formatted text", () => {
  const sections = [{ title: "From the publisher", content: '<p class="sample">A &amp; B <strong>together</strong>. <a href="/myhealthfinder/another">Next</a></p><style>irrelevant style</style>' }];
  const result = presentTopic({ ...detail, sections });
  assert.deepEqual(result.structuredContent, detail);
  assert.deepEqual(result._meta.article[0], {
    title: "From the publisher", nodes: [{ tag: "p", children: ["A & B ", { tag: "strong", children: ["together"] }, ". ",
      { tag: "a", children: ["Next"], href: "https://odphp.health.gov/myhealthfinder/another" }] }]
  });
  assert.doesNotMatch(result.content[0].text, /together/);
  assert.match(result.content[0].text, /2026-06-11/);
  assert.ok(result.content[0].text.includes(detail.sourceUrl));
  assert.match(result.content[0].text, /MyHF\.svg/);
});

test("unapproved embedded media and off-origin links introduce no external resources", () => {
  const sections = [{ title: "Sources", content: '<p><a href="https://example.org">More information</a> <img src="https://example.org/sample.png" alt="Figure description"><a href="blob:https://odphp.health.gov/resource">Caption</a></p>' }];
  const result = presentTopic({ ...detail, sections });
  assert.deepEqual(result._meta.article[0].nodes, [{ tag: "p", children: ["More information", " ", "Figure description", "Caption"] }]);
});

test("a missing localized topic returns only the requested language and offers a user choice", () => {
  const missing = { status: "not_found", topicId: "30602", language: "es" };
  const result = presentTopic(missing);
  assert.deepEqual(result.structuredContent, missing);
  assert.equal(result._meta, undefined);
  assert.match(result.content[0].text, /solicitar la versión en inglés/);
});
