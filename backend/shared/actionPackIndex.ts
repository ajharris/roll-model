import { getItem, queryItems } from './db';
import { parseEntryRecord } from './entries';
import { normalizeToken, tokenizeText } from './keywords';
import type { ActionPack, ActionPackFieldKey, ConfidenceLevel, Entry } from './types';

const ACTION_PACK_FIELDS: ActionPackFieldKey[] = [
  'wins',
  'leaks',
  'oneFocus',
  'drills',
  'positionalRequests',
  'fallbackDecisionGuidance'
];

const CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  low: 1
};

const normalizeActionPackValues = (actionPack: ActionPack, field: ActionPackFieldKey): string[] => {
  const source = actionPack[field];
  if (Array.isArray(source)) {
    return source;
  }
  if (typeof source === 'string') {
    return [source];
  }
  return [];
};

const resolveFieldConfidence = (actionPack: ActionPack, field: ActionPackFieldKey): ConfidenceLevel => {
  const match = (actionPack.confidenceFlags ?? []).find((flag) => flag.field === field);
  if (!match) return 'medium';
  return match.confidence;
};

const toQueryToken = (value: string | undefined): string => {
  if (!value) return '';
  const tokenized = tokenizeText(value).map((token) => normalizeToken(token));
  if (tokenized.length > 0) {
    return tokenized[0];
  }
  return normalizeToken(value);
};

const toFieldTokens = (actionPack: ActionPack, field: ActionPackFieldKey): string[] => {
  const values = normalizeActionPackValues(actionPack, field);
  const tokens = values
    .flatMap((value) => tokenizeText(value))
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 3);
  return [...new Set(tokens)].slice(0, 24);
};

export const buildActionPackIndexItems = (entry: Entry): Array<Record<string, unknown>> => {
  const actionPack = entry.actionPackFinal?.actionPack;
  if (!actionPack) {
    return [];
  }

  const items: Array<Record<string, unknown>> = [];

  for (const field of ACTION_PACK_FIELDS) {
    const confidence = resolveFieldConfidence(actionPack, field);
    const tokens = toFieldTokens(actionPack, field);

    for (const token of tokens) {
      items.push({
        PK: `USER#${entry.athleteId}`,
        SK: `APF#${field}#${token}#TS#${entry.createdAt}#ENTRY#${entry.entryId}`,
        entityType: 'ACTION_PACK_INDEX',
        indexScope: 'athlete',
        athleteId: entry.athleteId,
        entryId: entry.entryId,
        createdAt: entry.createdAt,
        finalizedAt: entry.actionPackFinal?.finalizedAt,
        field,
        token,
        confidence
      });
      items.push({
        PK: `APF_GLOBAL#${field}#${token}`,
        SK: `TS#${entry.createdAt}#USER#${entry.athleteId}#ENTRY#${entry.entryId}`,
        entityType: 'ACTION_PACK_INDEX',
        indexScope: 'global',
        athleteId: entry.athleteId,
        entryId: entry.entryId,
        createdAt: entry.createdAt,
        finalizedAt: entry.actionPackFinal?.finalizedAt,
        field,
        token,
        confidence
      });
    }
  }

  return items;
};

export const buildActionPackDeleteKeys = (entry: Entry): Array<{ PK: string; SK: string }> => {
  const actionPack = entry.actionPackFinal?.actionPack;
  if (!actionPack) {
    return [];
  }

  const keys: Array<{ PK: string; SK: string }> = [];

  for (const field of ACTION_PACK_FIELDS) {
    for (const token of toFieldTokens(actionPack, field)) {
      keys.push({
        PK: `USER#${entry.athleteId}`,
        SK: `APF#${field}#${token}#TS#${entry.createdAt}#ENTRY#${entry.entryId}`
      });
      keys.push({
        PK: `APF_GLOBAL#${field}#${token}`,
        SK: `TS#${entry.createdAt}#USER#${entry.athleteId}#ENTRY#${entry.entryId}`
      });
    }
  }

  return keys;
};

const parseActionPackField = (value: string | undefined): ActionPackFieldKey | null => {
  if (!value) return null;
  if (ACTION_PACK_FIELDS.includes(value as ActionPackFieldKey)) {
    return value as ActionPackFieldKey;
  }
  return null;
};

const parseMinConfidence = (value: string | undefined): ConfidenceLevel | null => {
  if (!value) return null;
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return null;
};

const confidenceAllowed = (actual: ConfidenceLevel, min: ConfidenceLevel | null): boolean => {
  if (!min) return true;
  return CONFIDENCE_WEIGHT[actual] >= CONFIDENCE_WEIGHT[min];
};

export const queryActionPackAthleteEntries = async (params: {
  athleteId: string;
  field: string | undefined;
  token: string | undefined;
  minConfidence?: string;
  limit?: number;
}): Promise<Entry[]> => {
  const field = parseActionPackField(params.field);
  const token = toQueryToken(params.token);
  const minConfidence = parseMinConfidence(params.minConfidence);
  if (!field || !token) {
    return [];
  }

  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${params.athleteId}`,
      ':prefix': `APF#${field}#${token}#TS#`
    },
    ScanIndexForward: false,
    Limit: Math.min(params.limit ?? 100, 200)
  });

  const indexed = (result.Items ?? []).filter(
    (item) =>
      item.entityType === 'ACTION_PACK_INDEX' &&
      typeof item.entryId === 'string' &&
      typeof item.createdAt === 'string' &&
      (item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low')
  ) as Array<{ entryId: string; createdAt: string; confidence: ConfidenceLevel }>;

  const entries: Entry[] = [];
  for (const item of indexed) {
    if (!confidenceAllowed(item.confidence, minConfidence)) {
      continue;
    }
    const entry = await getItem({
      Key: {
        PK: `USER#${params.athleteId}`,
        SK: `ENTRY#${item.createdAt}#${item.entryId}`
      }
    });
    if (!entry.Item || entry.Item.entityType !== 'ENTRY') {
      continue;
    }
    entries.push(parseEntryRecord(entry.Item as Record<string, unknown>));
  }

  return entries;
};

export interface ActionPackIndexedMatch {
  athleteId: string;
  entryId: string;
  createdAt: string;
  field: ActionPackFieldKey;
  token: string;
  confidence: ConfidenceLevel;
}

export const queryActionPackGlobalMatches = async (params: {
  field: string | undefined;
  token: string | undefined;
  minConfidence?: string;
  limit?: number;
}): Promise<ActionPackIndexedMatch[]> => {
  const field = parseActionPackField(params.field);
  const token = toQueryToken(params.token);
  const minConfidence = parseMinConfidence(params.minConfidence);
  if (!field || !token) {
    return [];
  }

  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `APF_GLOBAL#${field}#${token}`,
      ':prefix': 'TS#'
    },
    ScanIndexForward: false,
    Limit: Math.min(params.limit ?? 100, 500)
  });

  const items = (result.Items ?? []).filter(
    (item) =>
      item.entityType === 'ACTION_PACK_INDEX' &&
      typeof item.athleteId === 'string' &&
      typeof item.entryId === 'string' &&
      typeof item.createdAt === 'string' &&
      (item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low')
  ) as Array<ActionPackIndexedMatch>;

  return items.filter((item) => confidenceAllowed(item.confidence, minConfidence));
};
