import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { SavedEntrySearch, UpsertSavedEntrySearchRequest } from './types';

type SavedSearchRecordEnvelope = {
  PK: string;
  SK: string;
  entityType: string;
};

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const optionalString = (value: unknown): string | undefined => {
  const parsed = asString(value);
  if (parsed === null) return undefined;
  const trimmed = parsed.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeGiOrNoGi = (value: unknown): '' | 'gi' | 'no-gi' => {
  if (value === 'gi' || value === 'no-gi') return value;
  return '';
};

const normalizeSortBy = (value: unknown): 'createdAt' | 'intensity' => {
  if (value === 'intensity') return 'intensity';
  return 'createdAt';
};

const normalizeSortDirection = (value: unknown): 'asc' | 'desc' => {
  if (value === 'asc') return 'asc';
  return 'desc';
};

export const getSavedSearchIdFromPath = (savedSearchId?: string): string => {
  if (!savedSearchId) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Saved search ID is required.',
      statusCode: 400
    });
  }

  return savedSearchId;
};

export const parseUpsertSavedEntrySearchRequest = (
  event: APIGatewayProxyEvent
): UpsertSavedEntrySearchRequest => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(event.body) as Partial<UpsertSavedEntrySearchRequest>;

  const name = asString(parsed.name)?.trim() ?? '';
  const query = asString(parsed.query);
  const tag = asString(parsed.tag);
  const minIntensity = asString(parsed.minIntensity);
  const maxIntensity = asString(parsed.maxIntensity);

  if (!name || query === null || tag === null || minIntensity === null || maxIntensity === null) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Saved search payload is invalid.',
      statusCode: 400
    });
  }

  if (
    parsed.isPinned !== undefined && typeof parsed.isPinned !== 'boolean' ||
    parsed.isFavorite !== undefined && typeof parsed.isFavorite !== 'boolean'
  ) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Saved search payload is invalid.',
      statusCode: 400
    });
  }

  return {
    name,
    query,
    tag,
    giOrNoGi: normalizeGiOrNoGi(parsed.giOrNoGi),
    minIntensity,
    maxIntensity,
    ...(optionalString(parsed.dateFrom) ? { dateFrom: optionalString(parsed.dateFrom) } : {}),
    ...(optionalString(parsed.dateTo) ? { dateTo: optionalString(parsed.dateTo) } : {}),
    ...(optionalString(parsed.position) ? { position: optionalString(parsed.position) } : {}),
    ...(optionalString(parsed.partner) ? { partner: optionalString(parsed.partner) } : {}),
    ...(optionalString(parsed.technique) ? { technique: optionalString(parsed.technique) } : {}),
    ...(optionalString(parsed.outcome) ? { outcome: optionalString(parsed.outcome) } : {}),
    ...(optionalString(parsed.classType) ? { classType: optionalString(parsed.classType) } : {}),
    sortBy: normalizeSortBy(parsed.sortBy),
    sortDirection: normalizeSortDirection(parsed.sortDirection),
    ...(typeof parsed.isPinned === 'boolean' ? { isPinned: parsed.isPinned } : {}),
    ...(typeof parsed.isFavorite === 'boolean' ? { isFavorite: parsed.isFavorite } : {})
  };
};

export const buildSavedEntrySearch = (
  userId: string,
  payload: UpsertSavedEntrySearchRequest,
  nowIso: string,
  id: string
): SavedEntrySearch => ({
  id,
  userId,
  name: payload.name.trim(),
  query: payload.query,
  tag: payload.tag,
  giOrNoGi: payload.giOrNoGi,
  minIntensity: payload.minIntensity,
  maxIntensity: payload.maxIntensity,
  ...(payload.dateFrom ? { dateFrom: payload.dateFrom } : {}),
  ...(payload.dateTo ? { dateTo: payload.dateTo } : {}),
  ...(payload.position ? { position: payload.position } : {}),
  ...(payload.partner ? { partner: payload.partner } : {}),
  ...(payload.technique ? { technique: payload.technique } : {}),
  ...(payload.outcome ? { outcome: payload.outcome } : {}),
  ...(payload.classType ? { classType: payload.classType } : {}),
  sortBy: payload.sortBy,
  sortDirection: payload.sortDirection,
  ...(payload.isPinned !== undefined ? { isPinned: payload.isPinned } : {}),
  ...(payload.isFavorite !== undefined ? { isFavorite: payload.isFavorite } : {}),
  createdAt: nowIso,
  updatedAt: nowIso
});

export const parseSavedEntrySearchRecord = (item: Record<string, unknown>): SavedEntrySearch => {
  const { PK: _pk, SK: _sk, entityType: _entityType, ...rest } = item as SavedSearchRecordEnvelope &
    Record<string, unknown>;
  void _pk;
  void _sk;
  void _entityType;

  const id = asString(rest.id)?.trim() ?? '';
  const userId = asString(rest.userId)?.trim() ?? '';
  const name = asString(rest.name)?.trim() ?? '';
  const query = asString(rest.query) ?? '';
  const tag = asString(rest.tag) ?? '';
  const minIntensity = asString(rest.minIntensity) ?? '';
  const maxIntensity = asString(rest.maxIntensity) ?? '';
  const dateFrom = optionalString(rest.dateFrom);
  const dateTo = optionalString(rest.dateTo);
  const position = optionalString(rest.position);
  const partner = optionalString(rest.partner);
  const technique = optionalString(rest.technique);
  const outcome = optionalString(rest.outcome);
  const classType = optionalString(rest.classType);
  const createdAt = asString(rest.createdAt)?.trim() ?? '';
  const updatedAt = asString(rest.updatedAt)?.trim() ?? '';

  if (!id || !userId || !name || !createdAt || !updatedAt) {
    throw new Error('Invalid saved search record');
  }

  return {
    id,
    userId,
    name,
    query,
    tag,
    giOrNoGi: normalizeGiOrNoGi(rest.giOrNoGi),
    minIntensity,
    maxIntensity,
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(position ? { position } : {}),
    ...(partner ? { partner } : {}),
    ...(technique ? { technique } : {}),
    ...(outcome ? { outcome } : {}),
    ...(classType ? { classType } : {}),
    sortBy: normalizeSortBy(rest.sortBy),
    sortDirection: normalizeSortDirection(rest.sortDirection),
    ...(typeof rest.isPinned === 'boolean' ? { isPinned: rest.isPinned } : {}),
    ...(typeof rest.isFavorite === 'boolean' ? { isFavorite: rest.isFavorite } : {}),
    createdAt,
    updatedAt
  };
};
