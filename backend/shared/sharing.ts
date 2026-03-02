import { createHash, randomBytes, randomUUID } from 'crypto';

import { ApiError } from './responses';
import type {
  Entry,
  ShareAuditEvent,
  ShareCoachReviewState,
  ShareEventType,
  ShareFieldKey,
  ShareLink,
  SharePolicy,
  SharedSessionHighlight,
  SharedSessionSummary,
} from './types';

export const SHARE_PAYLOAD_VERSION = 1;
const MAX_EXPIRY_HOURS = 24 * 30;
const DEFAULT_EXPIRY_HOURS = 72;

const SHARE_FIELD_KEYS: ShareFieldKey[] = [
  'quickAdd',
  'sections.shared',
  'sessionMetrics',
  'sessionContext',
  'structured',
  'structuredExtraction',
  'actionPack',
  'sessionReview',
  'rawTechniqueMentions',
  'mediaAttachments',
  'partnerOutcomes',
];

const DEFAULT_INCLUDE_FIELDS: ShareFieldKey[] = [
  'structured',
  'structuredExtraction',
  'actionPack',
  'sessionReview',
  'sessionMetrics',
];

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400,
  });
};

const forbidden = (message: string): never => {
  throw new ApiError({
    code: 'FORBIDDEN',
    message,
    statusCode: 403,
  });
};

const notFound = (message: string): never => {
  throw new ApiError({
    code: 'NOT_FOUND',
    message,
    statusCode: 404,
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const sanitizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseFieldList = (value: unknown, fieldPath: string): ShareFieldKey[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    invalid(`${fieldPath} must be an array.`);
  }
  const values = value as unknown[];

  const deduped = new Set<ShareFieldKey>();
  for (const item of values) {
    const normalized = sanitizeString(item);
    if (!SHARE_FIELD_KEYS.includes(normalized as ShareFieldKey)) {
      invalid(`${fieldPath} contains unsupported field "${String(item)}".`);
    }
    deduped.add(normalized as ShareFieldKey);
  }

  return [...deduped];
};

const parseEntryIds = (value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    invalid('entryIds must be an array of strings when provided.');
  }
  const values = value as unknown[];

  const deduped = new Set<string>();
  for (const item of values) {
    const normalized = sanitizeString(item);
    if (!normalized) {
      invalid('entryIds must not contain empty values.');
    }
    deduped.add(normalized);
  }

  return [...deduped];
};

export interface CreateShareLinkRequest {
  policy: SharePolicy;
  coachReview: ShareCoachReviewState;
  expiresAt: string;
}

const parseOptionalIsoDate = (value: unknown, fieldPath: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = sanitizeString(value);
  if (!normalized) {
    invalid(`${fieldPath} must be a non-empty ISO timestamp when provided.`);
  }
  if (!Number.isFinite(Date.parse(normalized))) {
    invalid(`${fieldPath} must be a valid ISO timestamp.`);
  }
  return normalized;
};

const parseOptionalSkillId = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = sanitizeString(value).toLowerCase();
  if (!normalized) {
    invalid('skillId must be a non-empty string when provided.');
  }
  return normalized;
};

const parseCoachReview = (value: unknown): ShareCoachReviewState => {
  if (value === undefined) {
    return {
      required: false,
      approved: true,
    };
  }

  const record = asRecord(value);
  if (!record) {
    invalid('coachReview must be an object when provided.');
  }
  const parsed = record as Record<string, unknown>;

  const required = Boolean(parsed.required);
  const approved = Boolean(parsed.approved);
  const reviewedAt = sanitizeString(parsed.reviewedAt);
  const reviewedBy = sanitizeString(parsed.reviewedBy);
  const notes = sanitizeString(parsed.notes);

  return {
    required,
    approved,
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(reviewedBy ? { reviewedBy } : {}),
    ...(notes ? { notes } : {}),
  };
};

const resolveExpiresAt = (nowIso: string, expiresInHoursRaw: unknown): string => {
  if (expiresInHoursRaw === undefined) {
    return new Date(Date.parse(nowIso) + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  }

  if (typeof expiresInHoursRaw !== 'number' || !Number.isFinite(expiresInHoursRaw)) {
    invalid('expiresInHours must be a finite number when provided.');
  }
  const expiresInHoursNumber = expiresInHoursRaw as number;

  const expiresInHours = Math.floor(expiresInHoursNumber);
  if (expiresInHours < 1 || expiresInHours > MAX_EXPIRY_HOURS) {
    invalid(`expiresInHours must be between 1 and ${MAX_EXPIRY_HOURS}.`);
  }

  return new Date(Date.parse(nowIso) + expiresInHours * 60 * 60 * 1000).toISOString();
};

export const parseCreateShareLinkRequest = (
  rawBody: string | null,
  nowIso: string,
  options?: { enforceCoachReview?: boolean }
): CreateShareLinkRequest => {
  if (!rawBody) {
    invalid('Request body is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody as string);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payload = asRecord(parsed);
  if (!payload) {
    invalid('Request body must be a JSON object.');
  }
  const requestPayload = payload as Record<string, unknown>;

  const visibility = requestPayload.visibility === undefined ? 'private' : sanitizeString(requestPayload.visibility);
  if (visibility !== 'private') {
    invalid('visibility must be private.');
  }

  const includeFields = parseFieldList(requestPayload.includeFields, 'includeFields');
  const excludeFields = parseFieldList(requestPayload.excludeFields, 'excludeFields');
  const includePartnerData = requestPayload.includePartnerData === true;
  const entryIds = parseEntryIds(requestPayload.entryIds);
  const dateFrom = parseOptionalIsoDate(requestPayload.dateFrom, 'dateFrom');
  const dateTo = parseOptionalIsoDate(requestPayload.dateTo, 'dateTo');
  const skillId = parseOptionalSkillId(requestPayload.skillId);
  const coachId = sanitizeString(requestPayload.coachId);
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) {
    invalid('dateFrom must be earlier than or equal to dateTo.');
  }

  const requestCoachReview = requestPayload.requireCoachReview === true || options?.enforceCoachReview === true;
  const coachReview = parseCoachReview(requestPayload.coachReview);
  if (requestCoachReview && !coachReview.approved) {
    forbidden('Coach review approval is required before publishing share links.');
  }

  const expiresAt = resolveExpiresAt(nowIso, requestPayload.expiresInHours);

  return {
    policy: {
      visibility: 'private',
      includeFields,
      excludeFields,
      includePartnerData,
      ...(entryIds && entryIds.length > 0 ? { entryIds } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(skillId ? { skillId } : {}),
      ...(coachId ? { coachId } : {}),
      requireCoachReview: requestCoachReview,
    },
    coachReview: {
      ...coachReview,
      required: requestCoachReview,
      approved: requestCoachReview ? true : coachReview.approved,
      ...(requestCoachReview && !coachReview.reviewedAt ? { reviewedAt: nowIso } : {}),
    },
    expiresAt,
  };
};

const isStructuredRecord = (entry: Entry): boolean => {
  const hasStructuredFields = Boolean(entry.structured && Object.keys(entry.structured).length > 0);
  const hasExtraction = Boolean(entry.structuredExtraction && entry.structuredExtraction.suggestions.length > 0);
  const hasActionPack = Boolean(entry.actionPackFinal?.actionPack || entry.actionPackDraft);
  const hasSessionReview = Boolean(entry.sessionReviewFinal?.review || entry.sessionReviewDraft);
  return hasStructuredFields || hasExtraction || hasActionPack || hasSessionReview;
};

const toFrequencyTop = (values: string[], limit = 5): string[] => {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized) return;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([value]) => value);
};

const selectedFields = (policy: SharePolicy): Set<ShareFieldKey> => {
  const resolved = new Set<ShareFieldKey>(DEFAULT_INCLUDE_FIELDS);
  policy.includeFields.forEach((field) => resolved.add(field));
  policy.excludeFields.forEach((field) => resolved.delete(field));

  if (!policy.includePartnerData) {
    resolved.delete('partnerOutcomes');
  }

  return resolved;
};

const buildHighlight = (entry: Entry, fields: Set<ShareFieldKey>): SharedSessionHighlight => {
  const highlight: SharedSessionHighlight = {
    entryId: entry.entryId,
    createdAt: entry.createdAt,
  };

  if (fields.has('quickAdd')) {
    highlight.quickAdd = entry.quickAdd;
  }
  if (fields.has('sections.shared')) {
    highlight.sharedSection = entry.sections.shared;
  }
  if (fields.has('sessionMetrics')) {
    highlight.sessionMetrics = entry.sessionMetrics;
  }
  if (fields.has('sessionContext') && entry.sessionContext) {
    highlight.sessionContext = entry.sessionContext;
  }
  if (fields.has('structured') && entry.structured) {
    highlight.structured = entry.structured;
  }
  if (fields.has('structuredExtraction') && entry.structuredExtraction) {
    highlight.structuredExtraction = entry.structuredExtraction;
  }
  if (fields.has('actionPack')) {
    highlight.actionPack = entry.actionPackFinal?.actionPack ?? entry.actionPackDraft;
  }
  if (fields.has('sessionReview')) {
    highlight.sessionReview = entry.sessionReviewFinal?.review ?? entry.sessionReviewDraft;
  }
  if (fields.has('rawTechniqueMentions') && entry.rawTechniqueMentions.length > 0) {
    highlight.rawTechniqueMentions = entry.rawTechniqueMentions;
  }
  if (fields.has('mediaAttachments') && entry.mediaAttachments && entry.mediaAttachments.length > 0) {
    highlight.mediaAttachments = entry.mediaAttachments;
  }
  if (fields.has('partnerOutcomes') && entry.partnerOutcomes && entry.partnerOutcomes.length > 0) {
    highlight.partnerOutcomes = entry.partnerOutcomes;
  }

  return highlight;
};

const entryMatchesSkill = (entry: Entry, skillId: string): boolean => {
  const token = skillId.trim().toLowerCase();
  if (!token) {
    return true;
  }

  const values: string[] = [
    entry.structured?.position ?? '',
    entry.structured?.technique ?? '',
    entry.structured?.outcome ?? '',
    entry.structured?.problem ?? '',
    entry.structured?.cue ?? '',
    ...(entry.rawTechniqueMentions ?? []),
    ...(entry.structuredExtraction?.concepts ?? []),
    ...(entry.structuredExtraction?.failures ?? []),
    ...(entry.actionPackDraft?.wins ?? []),
    ...(entry.actionPackDraft?.leaks ?? []),
    ...(entry.actionPackDraft?.drills ?? []),
    ...(entry.actionPackDraft?.positionalRequests ?? []),
    entry.actionPackDraft?.fallbackDecisionGuidance ?? '',
  ];

  const haystack = values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return haystack.some((value) => value.includes(token));
};

export const buildSharedSessionSummary = (
  params: {
    shareId: string;
    athleteId: string;
    generatedAt: string;
    policy: SharePolicy;
    entries: Entry[];
  }
): SharedSessionSummary => {
  let scopedEntries = params.entries;
  if (params.policy.entryIds?.length) {
    scopedEntries = scopedEntries.filter((entry) => params.policy.entryIds?.includes(entry.entryId));
  }
  if (params.policy.dateFrom) {
    scopedEntries = scopedEntries.filter((entry) => Date.parse(entry.createdAt) >= Date.parse(params.policy.dateFrom as string));
  }
  if (params.policy.dateTo) {
    scopedEntries = scopedEntries.filter((entry) => Date.parse(entry.createdAt) <= Date.parse(params.policy.dateTo as string));
  }
  if (params.policy.skillId) {
    scopedEntries = scopedEntries.filter((entry) => entryMatchesSkill(entry, params.policy.skillId as string));
  }

  const structuredEntries = scopedEntries
    .filter((entry) => isStructuredRecord(entry))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (structuredEntries.length === 0) {
    invalid('No structured session records found for sharing scope.');
  }

  const fields = selectedFields(params.policy);
  const highlights = structuredEntries.map((entry) => buildHighlight(entry, fields));

  const concepts = structuredEntries.flatMap((entry) => entry.structuredExtraction?.concepts ?? []);
  const failures = structuredEntries.flatMap((entry) => entry.structuredExtraction?.failures ?? []);
  const conditioningIssues = structuredEntries.flatMap((entry) => entry.structuredExtraction?.conditioningIssues ?? []);

  return {
    summaryId: params.shareId,
    athleteId: params.athleteId,
    generatedAt: params.generatedAt,
    payloadVersion: SHARE_PAYLOAD_VERSION,
    sourceEntryIds: structuredEntries.map((entry) => entry.entryId),
    scope: {
      visibility: 'private',
      includeFields: [...fields],
      excludeFields: params.policy.excludeFields,
      includePartnerData: params.policy.includePartnerData,
      ...(params.policy.dateFrom ? { dateFrom: params.policy.dateFrom } : {}),
      ...(params.policy.dateTo ? { dateTo: params.policy.dateTo } : {}),
      ...(params.policy.skillId ? { skillId: params.policy.skillId } : {}),
      ...(params.policy.coachId ? { coachId: params.policy.coachId } : {}),
      readOnly: true,
    },
    aggregate: {
      topConcepts: toFrequencyTop(concepts),
      recurringFailures: toFrequencyTop(failures),
      conditioningIssues: toFrequencyTop(conditioningIssues),
    },
    highlights,
  };
};

export const hashShareToken = (token: string, salt = ''): string => {
  const hash = createHash('sha256');
  hash.update(`${salt}:${token}`);
  return hash.digest('hex');
};

export const issueShareToken = (salt = ''): { token: string; tokenHash: string } => {
  const token = `${randomUUID()}${randomBytes(12).toString('hex')}`;
  return {
    token,
    tokenHash: hashShareToken(token, salt),
  };
};

export const buildShareLinkItemKey = (athleteId: string, shareId: string): { PK: string; SK: string } => ({
  PK: `USER#${athleteId}`,
  SK: `SHARE_LINK#${shareId}`,
});

export const buildShareTokenMapKey = (tokenHash: string): { PK: string; SK: string } => ({
  PK: `SHARE_TOKEN#${tokenHash}`,
  SK: 'META',
});

export const buildShareEventSk = (createdAt: string, shareId: string, eventId: string): string =>
  `SHARE_EVENT#${createdAt}#${shareId}#${eventId}`;

export const buildShareAuditEvent = (params: {
  eventId: string;
  shareId: string;
  athleteId: string;
  eventType: ShareEventType;
  createdAt: string;
  payloadVersion: number;
  details?: Record<string, unknown>;
}): ShareAuditEvent => ({
  eventId: params.eventId,
  shareId: params.shareId,
  athleteId: params.athleteId,
  eventType: params.eventType,
  createdAt: params.createdAt,
  payloadVersion: params.payloadVersion,
  ...(params.details ? { details: params.details } : {}),
});

export const resolveShareBaseUrl = (): string => process.env.SHARE_BASE_URL?.trim() || 'https://share.invalid';

export const isExpired = (expiresAt: string, nowIso: string): boolean => Date.parse(expiresAt) <= Date.parse(nowIso);

export const parseShareLinkRecord = (item: Record<string, unknown>): ShareLink => {
  const { PK: _pk, SK: _sk, entityType: _entityType, ...rest } = item as Record<string, unknown> & {
    PK: string;
    SK: string;
    entityType: string;
  };
  void _pk;
  void _sk;
  void _entityType;
  return rest as unknown as ShareLink;
};

export const ensureShareTokenRecord = (item: Record<string, unknown> | undefined): {
  shareId: string;
  athleteId: string;
  status: ShareLink['status'];
  expiresAt: string;
} => {
  if (!item || item.entityType !== 'SHARE_TOKEN_MAP') {
    notFound('Share link not found.');
  }
  const tokenItem = item as Record<string, unknown>;

  const shareId = sanitizeString(tokenItem.shareId);
  const athleteId = sanitizeString(tokenItem.athleteId);
  const statusRaw = tokenItem.status;
  if (statusRaw !== 'active' && statusRaw !== 'revoked') {
    notFound('Share link not found.');
  }
  const status = statusRaw as ShareLink['status'];
  const expiresAt = sanitizeString(tokenItem.expiresAt);

  if (!shareId || !athleteId || !expiresAt) {
    notFound('Share link not found.');
  }

  return {
    shareId,
    athleteId,
    status,
    expiresAt,
  };
};
