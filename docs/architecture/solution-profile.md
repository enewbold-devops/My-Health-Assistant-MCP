# MyHealthfinder MCP development readiness

**November 28, 2026 — two-tool local prototype authorized.** The first milestone lets a consumer discover a public topic and open the official article in the requested language. The user selected a local Node origin on `develop` and will configure Cloudflare Tunnel and the ChatGPT development plugin manually. The milestone ends with an actual ChatGPT evaluation. Public Site hosting and use by other workspaces are later milestones. [Run and connect the prototype](../../README.md)

## Implemented tool contracts (v1.0.0)

| Tool | Inputs and upstream read | Output and follow-up |
| --- | --- | --- |
| `list_health_topics` | `language` defaults to `en` and accepts `en` or `es`. `offset` defaults to 0 (0–10,000) and `limit` to 20 (1–50). The service calls `GET itemlist.json` with the language and `type=topic`. | The result carries the language, total count, the current page of official topic IDs and titles, and the next offset or null. A recognized ID includes its primary skill ID from the static registry. A newly published topic is immediately browsable. |
| `get_health_topic` | Pass one catalog `topicId` as a string of 1–10 digits starting at 1–9, and carry the language from the list. The service calls `GET topicsearch.json` with that ID and language. | A verified article returns `found`, its identity, title, official URL, and publisher date. The component receives the formatted section text. A verified empty result returns `not_found` in the requested language. A service error yields an MCP tool error. |

The Node adapter creates a stateless SDK server for each exchange. The tool registration and domain service implement the two-tool policy through strict argument schemas, fixed GET targets, an eight-second deadline, a 512 KiB upstream response limit and source identity checks. Each tool call makes at most one upstream request. The presentation layer projects sections into inert text and approved elements and provides a link back to the complete original. These are the application-specific boundaries for the prototype. Separate engine classes, the other four tools and installable navigation skills remain design work. [Server and contracts](../../solutions/myhealthfinder-mcp/src/server.js) · [Domain service](../../solutions/myhealthfinder-mcp/src/domain.js) · [Presentation](../../solutions/myhealthfinder-mcp/src/presentation.js)

## Local verification on November 28, 2026

| Check | Evidence |
| --- | --- |
| Registry | The imported bytes match the SHA-256 in the discovery baseline. Git preserves LF line endings for this artifact on Windows. |
| Transport and handoff | Official JavaScript MCP clients 1.32.2 and 2.4.0 discovered exactly the two tools over loopback. The first client listed a Spanish catalog page. The second used a returned ID and language to open the matching live article. A local request with the intended Cloudflare Host header passed discovery. |
| Localized content | Both languages returned topic `527`. Spanish `30602` returned an empty result. Choosing English then opened the live shopping list, which has article text and an untitled section. |
| Presentation | A Chrome iframe test exercised the MCP Apps handshake, catalog selection, Spanish detail, official link, date, linked logo and explicit English fallback with real tool results. Article text stays in component metadata. The canonical source offers the publisher's complete page, including off-origin references. |
| Local controls | Offline tests cover invalid inputs with zero upstream calls, unknown tools, response mismatches, upstream failure, limits, and recovery. The Node listener binds to loopback. Its concurrency and rate caps apply to that process. The npm production dependency audit returned zero findings after removal of the unused UI scaffold library. |
| Pending manual evaluation | The owner configures the Cloudflare route and installs the development plugin. Confirm the actual tool list, visible article and language behavior in ChatGPT using the [three test prompts](../../README.md#test-in-chatgpt). |

## What the discovery established

The product uses live HHS Office of Disease Prevention and Health Promotion (ODPHP) content. The static English/Spanish registry holds routing metadata, skill associations and sample prompts. The proposed design has six MCP tools, ten navigation skills, eight workflows and eight handoffs (HC-001 through HC-008). The application-specific Orchestration Engine owns execution. The Policy Engine decides whether the request, outbound call and result may proceed. The engines run inside the MCP application. The upstream API remains the source for article text and update dates. [Design MCP API Orchestration](https://chatgpt.com/c/6b0a8481-2860-83ea-8376-c262a243df86) · [Architecture Feasibility Review](https://chatgpt.com/c/6b0aaf56-8f00-83e9-b6f8-c68b08673790)

| Proposed tool | Development scope |
| --- | --- |
| `list_health_topics` | First milestone. Read the requested language's topic inventory and return a bounded selection of IDs and official titles. |
| `get_health_topic` | First milestone. Accept a topic ID and language, validate the returned identity, and carry the canonical link, update date and attribution into the result. |
| `list_health_categories` | Add catalog browsing after the first journey works. |
| `search_health_topics` | Resolve approved topic aliases locally. Test a bounded public keyword or category lookup before enabling upstream filters. Keep raw conversation text out of outbound queries. |
| `get_related_health_topics` | Reuse related IDs from an existing topic result when available. An explicit follow-up validates the selected ID and language again. |
| `get_preventive_recommendations` | Design contract only for the initial plugin. Keep it out of tool discovery and block its upstream operation. Real age, sex or pregnancy inputs require a separate data-scope and hosting decision. |

## Discovery baseline before implementation

- **Repository.** Local and GitHub `develop` matched at `8a97e64`. The shared reference was pinned at `be58f6c`. The application directory contains a manifest and lockfile. Node 22.23.2 resolved the installed MCP server 2.4.0, Node adapter 2.1.2 and Express adapter 2.0.2. Native ESM imports succeeded. The declared `index.js` is missing. There is no start script, application source, plugin package or test suite. The current `npm test` exits 1 with the manifest's placeholder message. [Application manifest](../../solutions/myhealthfinder-mcp/package.json)
- **Discovery artifact.** The downloaded `myhealthfinder-topic-skill-registry.json` contains 104 unique topic keys, 10 skills and 208 uniquely identified prompt cases. The English and Spanish IDs marked observed matched the live inventories exactly (104 and 103 respectively). The file is outside the checkout. Import a reviewed copy for implementation and retain its provenance. The reviewed file's SHA-256 is `c19a7908fd84efd712b062ba16a03daf44282b5c1aaca74a4222bf14ebb2bea3`.
- **Evaluation coverage.** Of those 208 cases, 207 expect `get_health_topic` as the first content tool and one checks locale reconciliation. They provide a routing suite. Add dedicated checks for browse-to-detail handoffs, search, related topics, policy denial, upstream failures and rendering. None of the prompt cases has been run against this application's plugin.
- **Live API.** Public GETs to the v4.0.1 catalog and topic endpoints succeeded without credentials. Topic `527` returned details in English and Spanish. Topic `30602` returned English details, while the Spanish request returned HTTP 200 with `Total=0`, `Error="False"` and no `Resources`. Treat this as an empty localized result and offer English only by explicit choice. [API usage](https://odphp.health.gov/our-work/national-health-initiatives/health-literacy/consumer-health-content/free-web-content/apis-developers/how-use-api) · [Spanish detail response](https://odphp.health.gov/myhealthfinder/api/v4/topicsearch.json?topicId=30602&lang=es)
- **Search evidence.** The English category inventory returned 43 records. The keyword `colorectal` returned three topics. The category filter returned three for `96` (Colorectal Cancer) and zero for `15` (Cancer). The response echoed a null `Query.CategoryId` in both cases. Do not infer parent-category expansion or use the query echo as evidence that the filter was applied. [ODPHP OpenAPI specification](https://odphp.health.gov/modules/custom/myhf_api/src/yaml/hfapiv4.yaml)

## First implementation and verification

| Order | Owner and work | Evidence to collect |
| --- | --- | --- |
| 1 | **Solution Architect and Engineering Lead.** Review the registry import and version the first two tool schemas, the ID/language handoff and the relevant policy decisions from the design. | Examples cover a valid topic, zero results, wrong language or ID, invalid arguments and an unavailable publisher. Decide how each supported surface will display syndicated material. |
| 2 | **MCP Platform Engineer.** Add an explicit native ESM entry point, start and test scripts, a stateless Streamable HTTP adapter, both registered tools and an injectable API client. Validate input, restrict outbound GETs to the approved origin and paths, bound calls and payloads, and validate source fields before release. | Fixture tests and a local MCP client exercise `initialize`, `tools/list` and `tools/call`. A discovered ID opens the correct localized article on a fresh request. Unknown fields and a disabled operation cause zero upstream calls. |
| 3 | **Agentic UI Engineer and Security Reviewer.** Exercise both the rendered view and chat fallback. Keep source wording intact. Wherever publisher content appears, display the linked MyHealthfinder logo and show the publisher's last-updated date for topic details. If a surface cannot meet these terms, resolve its presentation before syndicating content there. | Inspect what the user actually sees. Verify safe markup, preserved text and links, privacy-safe diagnostics and bounded behavior under timeout or invalid upstream data. [ODPHP terms](https://odphp.health.gov/our-work/national-health-initiatives/health-literacy/consumer-health-content/free-web-content/apis-developers/terms-use) |
| 4 | **Verification Engineer.** Connect the tested endpoint as a development plugin in the intended ChatGPT workspace, using a reachable development HTTPS URL or the supported Secure MCP Tunnel. Include the relevant routing skill and prompts when evaluating the agent's tool choice. | Confirm installation and tool discovery. Capture the selected tool, arguments, returned ID/language and visible attribution for an English case, a Spanish case and the missing translation. Repeat a follow-up in a fresh chat and confirm that the disabled tool is absent. [Connect a custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server) |

An example plugin evaluation starts with “Show me topics for preparing for a child's checkup,” then opens the selected article in Spanish. A second evaluation asks for the heart-healthy grocery list in Spanish. Success on the first requires a verified Spanish article. On the second, the plugin must communicate the live availability result and preserve the user's language choice. Inputs used in evaluation can all be synthetic. Record the trace and rendered answer so a plausible model response alone cannot earn a pass.

## Tier 1 qualification

These statuses record the discovery review. The subsequent authorization covers the two-tool local prototype and its development-plugin evaluation. Production release and hosting decisions remain open.

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Business fit | PASS for design | English- and Spanish-speaking consumers can find a publisher topic and open it. Measure correct routing and successful localized retrieval in the plugin evaluation. A user-time baseline has yet to be measured. |
| Source | PASS for the first two tools | ODPHP v4.0.1 documentation and live catalog/detail responses agree on the ID-to-detail handoff. |
| Rights | NOT VERIFIED for the app | Published syndication terms are available. UI and Verification must demonstrate attribution, update dates and content integrity on each display surface. |
| Data | PASS for the proposed first inputs | Only a public topic ID and language are needed. Security must verify enforcement before exposing the plugin. |
| Identity | PASS for upstream reads | The tested reads succeeded anonymously. Workspace installation permissions are an independent access check. |
| Operations | PASS for proposed scope | Two allowlisted GETs cover the first journey. Platform must enforce this boundary server-side. |
| State | PASS for proposed design | The client carries ID and language. Verification must repeat a call with a fresh client. |
| Runtime | NOT VERIFIED | Local package imports passed. Actual MCP lifecycle, Sites runtime and hosted outbound access each need execution evidence. |
| Access | NOT VERIFIED | Verify the development plugin first. Later test Site visibility, anonymous external MCP access and cross-workspace use independently. [Site-hosted plugin guidance](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites) |
| Safety | NOT VERIFIED | Security and Verification must exercise input restrictions, outbound and rendering controls, redacted diagnostics, time and payload limits, and overload handling. ODPHP documents unrestricted access frequency. Set an application call budget suited to the host. |

The two-tool milestone preserves the six-tool design. The reference team's [engineering instructions](../../references/shared/AGENTS.md), [profile selection guide](../../references/shared/docs/architecture/profiles/README.md), [Tier 1 profile](../../references/shared/docs/architecture/profiles/tier-1-public-stateless-mcp.md) and [assessment rules](../../references/shared/.agents/skills/enewbold-tier1-opportunity-assessment/references/qualification-rules.md) govern the handoff. The [reference core](../../references/shared/.agents/skills/enewbold-javascript-oop-scaffolding/assets/reference-core/README.md) supplies the composition and fixture patterns. For this prototype the real Node transport and user-managed tunnel implement the requested development topology.
