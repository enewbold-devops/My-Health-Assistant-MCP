import { readFileSync } from "node:fs";
import { parseFragment } from "parse5";

const origin = "https://odphp.health.gov";
const source = origin + "/myhealthfinder";
const attribution = "[![MyHealthfinder](" + origin + "/themes/custom/healthfinder/images/MyHF.svg)](" + source + ")";
const resourceUri = "ui://myhealthfinder/topics-v1.html";
const mimeType = "text/html;profile=mcp-app";
const html = readFileSync(new URL("../ui/topics.html", import.meta.url), "utf8");

export const topicToolMeta = { ui: { resourceUri } };

/** Register the self-contained viewer and limit its external asset access to the publisher. */
export function registerTopicView(server) {
  const metadata = {
    ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [origin] } },
    "openai/widgetDescription": "Bilingual topic catalog and original, dated MyHealthfinder articles."
  };
  server.registerResource("health-topic-view", resourceUri, { mimeType, _meta: metadata }, () => ({
    contents: [{ uri: resourceUri, mimeType, text: html, _meta: metadata }]
  }));
}

const discarded = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "form"]);
const kept = new Set(["p", "ul", "ol", "li", "strong", "em", "b", "i", "br", "h2", "h3", "h4",
  "h5", "h6", "blockquote", "sup", "sub", "table", "thead", "tbody", "tr", "td", "th", "caption"]);

/** Emit an inert tree of text and semantic elements. Publisher markup never enters an HTML sink. */
function articleNodes(children, sourceUrl, depth = 0) {
  if (depth > 60) throw new Error("Unsupported article nesting");
  const result = [];
  for (const node of children) {
    if (node.nodeName === "#text") {
      result.push(node.value);
      continue;
    }
    if (node.namespaceURI !== "http://www.w3.org/1999/xhtml" || discarded.has(node.tagName)) continue;
    if (node.tagName === "img") {
      const alt = node.attrs.find(attribute => attribute.name === "alt")?.value;
      if (alt) result.push(alt);
      continue;
    }
    const content = articleNodes(node.childNodes || [], sourceUrl, depth + 1);
    if (node.tagName === "a") {
      const href = node.attrs.find(attribute => attribute.name === "href")?.value;
      const target = href ? URL.parse(href, sourceUrl) : null;
      if (target?.protocol === "https:" && target.origin === origin && !target.username && !target.password) {
        result.push({ tag: "a", href: target.href, children: content });
        continue;
      }
    }
    if (kept.has(node.tagName)) result.push({ tag: node.tagName, children: content });
    else for (const child of content) result.push(child);
  }
  return result;
}

/** Render bounded catalog rows as literal Markdown lines for text-only MCP clients. */
export function presentList(data) {
  const spanish = data.language === "es";
  const caption = spanish
    ? `Se muestran ${data.topics.length} de ${data.total} temas en español.`
    : `Showing ${data.topics.length} of ${data.total} English topics.`;
  // Indented code lines keep publisher punctuation and brackets literal.
  const rows = data.topics.map(({ topicId, title }) => "    " + topicId + " — " + title.replace(/[\r\n\u2028\u2029]/g, " "));
  const parts = [caption, rows.join("\n")];
  if (data.nextOffset !== null) {
    parts.push(spanish
      ? `Para la siguiente página, usa list_health_topics con language=es y offset=${data.nextOffset}.`
      : `For the next page, use list_health_topics with language=en and offset=${data.nextOffset}.`);
  }
  parts.push(attribution);
  return { structuredContent: data, content: [{ type: "text", text: parts.filter(Boolean).join("\n\n") }] };
}

/** Keep article text in component-only metadata. Expose the official link and date in the transcript. */
export function presentTopic(data) {
  const { sections, ...metadata } = data;
  const spanish = data.language === "es";
  if (data.status === "not_found") {
    const text = spanish ? "No se encontró el tema en español. Puedes solicitar la versión en inglés."
      : "No English result was found for this topic.";
    return { structuredContent: metadata, content: [{ type: "text", text }] };
  }
  const date = data.lastUpdated.slice(0, 10);
  const text = spanish
    ? `[Artículo original](<${data.sourceUrl}>) · Actualizado el ${date}.`
    : `[Original article](<${data.sourceUrl}>) · Updated ${date}.`;
  const article = sections.map(section => ({
    title: section.title,
    nodes: articleNodes(parseFragment(section.content).childNodes, data.sourceUrl)
  }));
  return {
    structuredContent: metadata,
    content: [{ type: "text", text: text + "\n\n" + attribution }],
    _meta: { article }
  };
}
