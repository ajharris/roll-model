import { v4 as uuidv4 } from 'uuid';

import { getItem, putItem, queryItems } from './db';
import { ApiError } from './responses';
import type {
  CoachReviewState,
  PartnerProfile,
  PartnerProfileVisibility,
  PartnerOutcomeNote,
  UpsertPartnerProfileRequest
} from './types';

const TAG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VISIBILITY_VALUES = new Set<PartnerProfileVisibility>(['private', 'shared-with-coach']);

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const requireRecord = (value: unknown, message: string): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) {
    invalid(message);
  }
  return record as Record<string, unknown>;
};

const sanitizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const normalizeTagList = (value: unknown, fieldPath: string): string[] => {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    invalid(`${fieldPath} must be an array of strings.`);
  }

  const deduped = new Set<string>();
  for (const tag of value as string[]) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || !TAG_REGEX.test(normalized)) {
      invalid(`${fieldPath} contains invalid tag "${String(tag)}". Use lowercase kebab-case tags.`);
    }
    deduped.add(normalized);
  }

  return [...deduped];
};

const parseCoachReview = (value: unknown): CoachReviewState => {
  const record = requireRecord(value, 'guidance.coachReview must be an object.');

  if (record.requiresReview !== undefined && typeof record.requiresReview !== 'boolean') {
    invalid('guidance.coachReview.requiresReview must be a boolean.');
  }
  if (record.coachNotes !== undefined && typeof record.coachNotes !== 'string') {
    invalid('guidance.coachReview.coachNotes must be a string.');
  }
  if (record.reviewedAt !== undefined && typeof record.reviewedAt !== 'string') {
    invalid('guidance.coachReview.reviewedAt must be a string.');
  }

  const coachNotes = sanitizeString(record.coachNotes);
  const reviewedAt = sanitizeString(record.reviewedAt);
  return {
    requiresReview: Boolean(record.requiresReview),
    ...(coachNotes ? { coachNotes } : {}),
    ...(reviewedAt ? { reviewedAt } : {})
  };
};

const parseGuidance = (value: unknown): PartnerProfile['guidance'] => {
  if (value === undefined) {
    return undefined;
  }
  const record = requireRecord(value, 'guidance must be an object.');

  if (record.draft !== undefined && typeof record.draft !== 'string') {
    invalid('guidance.draft must be a string.');
  }
  if (record.final !== undefined && typeof record.final !== 'string') {
    invalid('guidance.final must be a string.');
  }

  const draft = sanitizeString(record.draft);
  const final = sanitizeString(record.final);
  const coachReview = record.coachReview !== undefined ? parseCoachReview(record.coachReview) : undefined;

  if (!draft && !final && !coachReview) {
    return undefined;
  }

  return {
    ...(draft ? { draft } : {}),
    ...(final ? { final } : {}),
    ...(coachReview ? { coachReview } : {})
  };
};

export const parsePartnerUpsertPayload = (rawBody: string | null): UpsertPartnerProfileRequest => {
  if (!rawBody) {
    invalid('Request body is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody as string);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payload = requireRecord(parsed, 'Request body must be a JSON object.');

  const displayName = payload.displayName;
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    invalid('displayName is required.');
  }
  const normalizedDisplayName = (displayName as string).trim();
  const styleTags = normalizeTagList(payload.styleTags, 'styleTags');
  const notes = sanitizeString(payload.notes);
  const visibility = payload.visibility === undefined ? 'private' : payload.visibility;
  if (typeof visibility !== 'string' || !VISIBILITY_VALUES.has(visibility as PartnerProfileVisibility)) {
    invalid('visibility must be one of: private, shared-with-coach.');
  }

  return {
    displayName: normalizedDisplayName,
    styleTags,
    ...(notes ? { notes } : {}),
    visibility: visibility as PartnerProfileVisibility,
    ...(payload.guidance !== undefined ? { guidance: parseGuidance(payload.guidance) } : {})
  };
};

export const buildPartnerProfile = (
  athleteId: string,
  input: UpsertPartnerProfileRequest,
  nowIso: string,
  partnerId = uuidv4()
): PartnerProfile => ({
  partnerId,
  athleteId,
  displayName: input.displayName.trim(),
  styleTags: input.styleTags,
  notes: input.notes?.trim() || undefined,
  visibility: input.visibility ?? 'private',
  guidance: input.guidance,
  createdAt: nowIso,
  updatedAt: nowIso
});

export const parsePartnerProfileRecord = (item: Record<string, unknown>): PartnerProfile => {
  const { PK: _pk, SK: _sk, entityType: _entityType, ...rest } = item as Record<string, unknown> & {
    PK: string;
    SK: string;
    entityType: string;
  };
  void _pk;
  void _sk;
  void _entityType;
  return rest as unknown as PartnerProfile;
};

export const listPartnerProfiles = async (athleteId: string): Promise<PartnerProfile[]> => {
  const rows = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${athleteId}`,
      ':prefix': 'PARTNER#'
    },
    ScanIndexForward: false
  });

  return (rows.Items ?? [])
    .filter((item) => item.entityType === 'PARTNER_PROFILE')
    .map((item) => parsePartnerProfileRecord(item as Record<string, unknown>));
};

export const getPartnerProfile = async (athleteId: string, partnerId: string): Promise<PartnerProfile | null> => {
  const row = await getItem({
    Key: {
      PK: `USER#${athleteId}`,
      SK: `PARTNER#${partnerId}`
    }
  });

  if (!row.Item || row.Item.entityType !== 'PARTNER_PROFILE') {
    return null;
  }

  return parsePartnerProfileRecord(row.Item as Record<string, unknown>);
};

export const putPartnerProfile = async (profile: PartnerProfile): Promise<void> => {
  await putItem({
    Item: {
      PK: `USER#${profile.athleteId}`,
      SK: `PARTNER#${profile.partnerId}`,
      entityType: 'PARTNER_PROFILE',
      ...profile
    }
  });
};

export const hydratePartnerOutcomes = async (
  athleteId: string,
  partnerOutcomes: PartnerOutcomeNote[] | undefined
): Promise<PartnerOutcomeNote[] | undefined> => {
  if (!partnerOutcomes || partnerOutcomes.length === 0) {
    return partnerOutcomes;
  }

  const uniquePartnerIds = [...new Set(partnerOutcomes.map((item) => item.partnerId))];
  const profileRows = await Promise.all(uniquePartnerIds.map((partnerId) => getPartnerProfile(athleteId, partnerId)));
  const profileById = new Map<string, PartnerProfile>();

  profileRows.forEach((profile, index) => {
    const partnerId = uniquePartnerIds[index];
    if (!profile) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `partnerOutcomes references unknown partnerId: ${partnerId}.`,
        statusCode: 400
      });
    }
    profileById.set(partnerId, profile);
  });

  return partnerOutcomes.map((item) => {
    const profile = profileById.get(item.partnerId)!;
    return {
      ...item,
      partnerDisplayName: profile.displayName,
      styleTags: item.styleTags.length > 0 ? item.styleTags : profile.styleTags
    };
  });
};
