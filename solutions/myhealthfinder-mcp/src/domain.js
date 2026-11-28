import registry from '../data/myhealthfinder-topic-skill-registry.json' with { type: 'json' };

const ORIGIN = 'https://odphp.health.gov';
const LANGUAGE_NAMES = { en: 'English', es: 'Spanish' };
const TOPIC_ID = /^[1-9][0-9]{0,9}$/;
const MAX_BYTES = 512 * 1024;
const MAX_TOPICS = 10_000;
const TIMEOUT_MS = 8_000;
const skillIds = { en: new Map(), es: new Map() };

for (const topic of registry.topics) {
  for (const language of Object.keys(skillIds)) {
    const topicId = topic.locales[language].topicId;
    if (topicId) skillIds[language].set(topicId, topic.primarySkillId);
  }
}

/** Only the stable code crosses the public error boundary. */
class TopicError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function validate(condition, code = 'INVALID_UPSTREAM') {
  if (!condition) throw new TopicError(code);
}

function validateInput(input, keys) {
  validate(input !== null && typeof input === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(input)) &&
    Object.keys(input).every(key => keys.includes(key)), 'INVALID_INPUT');
  const language = input.language === undefined ? 'en' : input.language;
  validate(language === 'en' || language === 'es', 'INVALID_INPUT');
  return language;
}

function validTitle(value) {
  return typeof value === 'string' && value.length <= 1_000 &&
    value.trim().length > 0 && !/[<>\u0000-\u001f\u007f]/u.test(value);
}

function canonicalUrl(value, language) {
  const prefix = language === 'en' ? '/myhealthfinder/' : '/espanol/myhealthfinder/';
  validate(typeof value === 'string' && value.length <= 2_048 && value.startsWith(ORIGIN + prefix));
  // Accept article slugs only. Never follow URLs supplied in the publisher payload.
  const segments = value.slice((ORIGIN + prefix).length).split('/');
  validate(segments.every(segment => /^[\p{L}\p{N}\p{M}_-]+$/u.test(decodeURIComponent(segment))));
  return new URL(value).href;
}

function updateDate(value) {
  validate(typeof value === 'string' && /^[0-9]{1,10}$/.test(value));
  return new Date(Number(value) * 1_000).toISOString();
}

function rowsFor(result, group, field) {
  const rows = result[group]?.[field];
  if (rows === undefined && result[group] == null && result.Total === 0) return [];
  validate(Array.isArray(rows) && rows.length === result.Total);
  return rows;
}

/** Read the decoded byte stream so a missing header or compression cannot bypass the cap. */
async function readJson(response) {
  const type = response.headers.get('content-type') ?? '';
  validate(/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type));
  const declared = response.headers.get('content-length');
  validate(declared === null || (/^\d+$/.test(declared) && Number(declared) <= MAX_BYTES));
  validate(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      validate(bytes <= MAX_BYTES);
      try {
        text += decoder.decode(value, { stream: true });
      } catch {
        throw new TopicError('INVALID_UPSTREAM');
      }
    }
    try {
      return JSON.parse(text + decoder.decode());
    } catch {
      throw new TopicError('INVALID_UPSTREAM');
    }
  } finally {
    reader.releaseLock();
  }
}

/** The two public, stateless catalog operations in the first development plugin. */
export class TopicService {
  #fetch;

  /** @param {typeof fetch} fetchImpl Web-standard provider transport. */
  constructor(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Expected a fetch implementation.');
    this.#fetch = fetchImpl;
  }

  async #request(operation, language, parameters) {
    const url = new URL('/myhealthfinder/api/v4/' + operation + '.json', ORIGIN);
    url.search = new URLSearchParams({ ...parameters, lang: language }).toString();
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let response;
    try {
      response = await this.#fetch(url, {
        method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' }, signal,
      });
      validate(!response.redirected && !(response.status >= 300 && response.status < 400));
      if (response.status === 429) throw new TopicError('RATE_LIMITED');
      if (response.status !== 200) throw new TopicError('UPSTREAM_FAILURE');
      const result = (await readJson(response))?.Result;
      validate(result && typeof result === 'object');
      if (result.Error === true || result.Error === 'True') throw new TopicError('UPSTREAM_FAILURE');
      validate((result.Error === 'False' || result.Error === false) && result.Language === LANGUAGE_NAMES[language]);
      validate(Number.isSafeInteger(result.Total) && result.Total >= 0 && result.Total <= MAX_TOPICS);
      return result;
    } catch (error) {
      if (error instanceof TopicError) throw error;
      throw new TopicError(signal.aborted || error?.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILURE');
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  }

  /** Fetch the current localized inventory, then page its titles and optional routing metadata. */
  async list(input = {}) {
    const language = validateInput(input, ['language', 'offset', 'limit']);
    const { offset = 0, limit = 20 } = input;
    validate(Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX_TOPICS &&
      Number.isSafeInteger(limit) && limit >= 1 && limit <= 50, 'INVALID_INPUT');
    const result = await this.#request('itemlist', language, { type: 'topic' });
    const rows = rowsFor(result, 'Items', 'Item');
    const ids = new Set();
    for (const row of rows) {
      validate(row?.Type === 'Topic' && typeof row.Id === 'string' && TOPIC_ID.test(row.Id) &&
        !ids.has(row.Id) && validTitle(row.Title));
      ids.add(row.Id);
    }
    const topics = rows.slice(offset, offset + limit).map(({ Id: topicId, Title: title }) => {
      const skillId = skillIds[language].get(topicId);
      return skillId ? { topicId, title, skillId } : { topicId, title };
    });
    const end = offset + topics.length;
    return { language, topics, total: rows.length, nextOffset: end < rows.length ? end : null };
  }

  /** Fetch one localized article. The presentation adapter must sanitize section HTML for component use only. */
  async get(input = {}) {
    const language = validateInput(input, ['language', 'topicId']);
    const { topicId } = input;
    validate(typeof topicId === 'string' && TOPIC_ID.test(topicId), 'INVALID_INPUT');
    const result = await this.#request('topicsearch', language, { topicId });
    const rows = rowsFor(result, 'Resources', 'Resource');
    if (!rows.length) return { language, topicId, status: 'not_found' };
    const [row] = rows;
    validate(rows.length === 1 && row?.Type === 'Topic' && row.Id === topicId && validTitle(row.Title));
    const rawSections = row.Sections?.section;
    validate(Array.isArray(rawSections) && rawSections.length > 0 && rawSections.length <= 128);
    const sections = rawSections.map(section => {
      validate(typeof section?.Content === 'string' && section.Content.trim().length > 0);
      // Some single-section articles have a body but no publisher-supplied heading.
      const title = section.Title ?? '';
      validate(typeof title === 'string' && title.length <= 1_000);
      if (!title.trim()) return { title: '', content: section.Content };
      validate(validTitle(title));
      return { title, content: section.Content };
    });
    let sourceUrl;
    try {
      sourceUrl = canonicalUrl(row.AccessibleVersion, language);
    } catch {
      throw new TopicError('INVALID_UPSTREAM');
    }
    return { language, topicId, status: 'found', title: row.Title, sourceUrl, lastUpdated: updateDate(row.LastUpdate), sections };
  }
}
