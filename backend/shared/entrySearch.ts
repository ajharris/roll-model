import type { Entry, EntrySearchMeta, EntrySearchRequest } from './types';

export const ENTRY_SEARCH_LATENCY_TARGET_MS = 75;

const normalizeText = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

const normalizeToken = (value: string | undefined): string =>
  normalizeText(value).replace(/\s+/g, ' ');

const countOccurrences = (haystack: string, needle: string): number => {
  if (!haystack || !needle) return 0;

  let count = 0;
  let start = 0;
  while (start < haystack.length) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) break;
    count += 1;
    start = index + needle.length;
  }
  return count;
};

const tokenize = (value: string): string[] =>
  normalizeToken(value)
    .split(/[\s,.;:/\\()[\]{}'"`!?+-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

type SearchIndex = {
  shared: string;
  privateText: string;
  tags: string;
  techniques: string;
  media: string;
  all: string;
};

const buildSearchIndex = (entry: Entry): SearchIndex => {
  const shared = normalizeText(entry.sections.shared);
  const privateText = normalizeText(entry.sections.private);
  const tags = normalizeText((entry.sessionMetrics.tags ?? []).join(' '));
  const techniques = normalizeText((entry.rawTechniqueMentions ?? []).join(' '));
  const media = normalizeText(
    (entry.mediaAttachments ?? [])
      .flatMap((attachment) => [
        attachment.title,
        attachment.url,
        attachment.notes ?? '',
        ...attachment.clipNotes.map((clip) => `${clip.timestamp} ${clip.text}`),
      ])
      .join(' '),
  );

  return {
    shared,
    privateText,
    tags,
    techniques,
    media,
    all: [shared, privateText, tags, techniques, media].filter(Boolean).join(' '),
  };
};

const toTimestamp = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const matchesDateRange = (entry: Entry, request: EntrySearchRequest): boolean => {
  const entryTs = toTimestamp(entry.createdAt);
  if (entryTs === null) return false;

  const fromTs = toTimestamp(request.dateFrom);
  if (fromTs !== null && entryTs < fromTs) return false;

  const toTs = toTimestamp(request.dateTo);
  if (toTs !== null) {
    const inclusiveUpperBound = request.dateTo?.length === 10 ? toTs + 86_399_999 : toTs;
    if (entryTs > inclusiveUpperBound) return false;
  }
  return true;
};

const matchesIntensity = (entry: Entry, request: EntrySearchRequest): boolean => {
  const min = Number(request.minIntensity);
  if (request.minIntensity && Number.isFinite(min) && entry.sessionMetrics.intensity < min) return false;

  const max = Number(request.maxIntensity);
  if (request.maxIntensity && Number.isFinite(max) && entry.sessionMetrics.intensity > max) return false;

  return true;
};

const matchesStructuredFilters = (entry: Entry, request: EntrySearchRequest): boolean => {
  if (request.tag && !(entry.sessionMetrics.tags ?? []).includes(request.tag)) return false;
  if (request.giOrNoGi && entry.sessionMetrics.giOrNoGi !== request.giOrNoGi) return false;
  if (!matchesDateRange(entry, request)) return false;
  if (!matchesIntensity(entry, request)) return false;
  return true;
};

const matchesTextFilter = (index: SearchIndex, value: string | undefined): boolean => {
  const token = normalizeToken(value);
  if (!token) return true;
  return index.all.includes(token);
};

const scoreTextQuery = (index: SearchIndex, query: string): number => {
  const q = normalizeToken(query);
  if (!q) return 0;

  const tokens = tokenize(q);
  if (tokens.length === 0) return 0;

  let score = 0;
  if (index.shared.includes(q)) score += 18;
  if (index.privateText.includes(q)) score += 10;
  if (index.techniques.includes(q)) score += 14;
  if (index.tags.includes(q)) score += 10;
  if (index.media.includes(q)) score += 6;

  tokens.forEach((token) => {
    score += countOccurrences(index.shared, token) * 5;
    score += countOccurrences(index.privateText, token) * 3;
    score += countOccurrences(index.techniques, token) * 6;
    score += countOccurrences(index.tags, token) * 4;
    score += countOccurrences(index.media, token) * 2;
  });

  return score;
};

const matchesPhase1JournalFilters = (index: SearchIndex, request: EntrySearchRequest): boolean => {
  if (!matchesTextFilter(index, request.position)) return false;
  if (!matchesTextFilter(index, request.partner)) return false;
  if (!matchesTextFilter(index, request.technique)) return false;
  if (!matchesTextFilter(index, request.outcome)) return false;

  if (request.classType) {
    const classType = normalizeToken(request.classType);
    if (!index.all.includes(classType)) return false;
  }

  return true;
};

const compareEntries = (a: Entry, b: Entry, request: EntrySearchRequest, scoreA: number, scoreB: number): number => {
  const sortDirection = request.sortDirection === 'asc' ? 1 : -1;
  const sortBy = request.sortBy === 'intensity' ? 'intensity' : 'createdAt';
  const hasTextQuery = normalizeToken(request.query).length > 0;

  if (hasTextQuery && scoreA !== scoreB) {
    return scoreB - scoreA;
  }

  if (sortBy === 'intensity') {
    const delta = a.sessionMetrics.intensity - b.sessionMetrics.intensity;
    if (delta !== 0) return delta * sortDirection;
  } else {
    const delta = a.createdAt.localeCompare(b.createdAt);
    if (delta !== 0) return delta * sortDirection;
  }

  return b.createdAt.localeCompare(a.createdAt);
};

const parseLimit = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 200);
};

const nowMs = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

export const searchEntries = (
  entries: Entry[],
  request: EntrySearchRequest,
): { entries: Entry[]; meta: EntrySearchMeta } => {
  const startedAt = nowMs();
  const scored = entries
    .map((entry) => {
      const index = buildSearchIndex(entry);
      return {
        entry,
        score: scoreTextQuery(index, request.query ?? ''),
        index,
      };
    })
    .filter(({ entry, index, score }) => {
      if (!matchesStructuredFilters(entry, request)) return false;
      if (!matchesPhase1JournalFilters(index, request)) return false;

      const q = normalizeToken(request.query);
      if (!q) return true;
      return score > 0;
    });

  scored.sort((a, b) => compareEntries(a.entry, b.entry, request, a.score, b.score));

  const limit = parseLimit(request.limit);
  const results = (limit ? scored.slice(0, limit) : scored).map((item) => item.entry);
  const latencyMs = Math.round((nowMs() - startedAt) * 100) / 100;
  const queryApplied = Boolean(
    normalizeToken(request.query) ||
      request.dateFrom ||
      request.dateTo ||
      request.position ||
      request.partner ||
      request.technique ||
      request.outcome ||
      request.classType ||
      request.tag ||
      request.giOrNoGi ||
      request.minIntensity ||
      request.maxIntensity,
  );

  return {
    entries: results,
    meta: {
      queryApplied,
      scannedCount: entries.length,
      matchedCount: scored.length,
      latencyMs,
      latencyTargetMs: ENTRY_SEARCH_LATENCY_TARGET_MS,
    },
  };
};

const pickString = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export const parseEntrySearchRequest = (
  params: Record<string, string | undefined> | null | undefined,
): EntrySearchRequest => {
  if (!params) return {};

  const giOrNoGi = params.giOrNoGi === 'gi' || params.giOrNoGi === 'no-gi' ? params.giOrNoGi : undefined;
  const sortBy = params.sortBy === 'intensity' ? 'intensity' : params.sortBy === 'createdAt' ? 'createdAt' : undefined;
  const sortDirection =
    params.sortDirection === 'asc' ? 'asc' : params.sortDirection === 'desc' ? 'desc' : undefined;

  return {
    query: pickString(params.q ?? params.query),
    dateFrom: pickString(params.dateFrom),
    dateTo: pickString(params.dateTo),
    position: pickString(params.position),
    partner: pickString(params.partner),
    technique: pickString(params.technique),
    outcome: pickString(params.outcome),
    classType: pickString(params.classType),
    tag: pickString(params.tag),
    giOrNoGi,
    minIntensity: pickString(params.minIntensity),
    maxIntensity: pickString(params.maxIntensity),
    sortBy,
    sortDirection,
    limit: pickString(params.limit),
  };
};
