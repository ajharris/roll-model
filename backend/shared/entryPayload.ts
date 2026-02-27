import type { APIGatewayProxyEvent } from 'aws-lambda';

import { isValidMediaAttachmentsInput } from './entries';
import { ApiError } from './responses';
import type { CreateEntryRequest, EntryStructuredFields, EntryTag } from './types';

const ENTRY_TAG_VALUES = new Set<EntryTag>([
  'guard-type',
  'top',
  'bottom',
  'submission',
  'sweep',
  'pass',
  'escape',
  'takedown'
]);

const STRUCTURED_FIELDS: Array<keyof EntryStructuredFields> = [
  'position',
  'technique',
  'outcome',
  'problem',
  'cue',
  'constraint'
];

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const parseEntryPayload = (event: APIGatewayProxyEvent): CreateEntryRequest => {
  if (event.body === null || event.body === undefined) {
    invalid('Request body is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body!);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payload = asRecord(parsed)!;
  if (payload === null) {
    invalid('Request body must be a JSON object.');
  }

  const quickAdd = asRecord(payload.quickAdd)!;
  if (quickAdd === null) {
    invalid('Entry payload is invalid: quickAdd must be an object.');
  }
  if (typeof quickAdd.time !== 'string') invalid('Entry payload is invalid: quickAdd.time must be a string.');
  if (typeof quickAdd.class !== 'string') invalid('Entry payload is invalid: quickAdd.class must be a string.');
  if (typeof quickAdd.gym !== 'string') invalid('Entry payload is invalid: quickAdd.gym must be a string.');
  if (!Array.isArray(quickAdd.partners) || quickAdd.partners.some((partner) => typeof partner !== 'string')) {
    invalid('Entry payload is invalid: quickAdd.partners must be an array of strings.');
  }
  if (typeof quickAdd.rounds !== 'number') invalid('Entry payload is invalid: quickAdd.rounds must be a number.');
  if (typeof quickAdd.notes !== 'string') invalid('Entry payload is invalid: quickAdd.notes must be a string.');

  if (!Array.isArray(payload.tags) || payload.tags.some((tag) => typeof tag !== 'string')) {
    invalid('Entry payload is invalid: tags must be an array of strings.');
  }
  const tags = payload.tags as string[];
  const invalidTag = tags.find((tag) => !ENTRY_TAG_VALUES.has(tag as EntryTag));
  if (invalidTag) {
    invalid(`Entry payload is invalid: tags contains unsupported value "${invalidTag}".`);
  }

  if (payload.structured !== undefined) {
    const structured = asRecord(payload.structured)!;
    if (structured === null) {
      invalid('Entry payload is invalid: structured must be an object.');
    }
    for (const field of STRUCTURED_FIELDS) {
      if (structured[field] !== undefined && typeof structured[field] !== 'string') {
        invalid(`Entry payload is invalid: structured.${field} must be a string.`);
      }
    }
  }

  const sections = asRecord(payload.sections)!;
  if (sections === null) {
    invalid('Entry payload is invalid: sections must be an object.');
  }
  if (typeof sections.private !== 'string') {
    invalid('Entry payload is invalid: sections.private must be a string.');
  }
  if (typeof sections.shared !== 'string') {
    invalid('Entry payload is invalid: sections.shared must be a string.');
  }

  const sessionMetrics = asRecord(payload.sessionMetrics)!;
  if (sessionMetrics === null) {
    invalid('Entry payload is invalid: sessionMetrics must be an object.');
  }
  if (typeof sessionMetrics.durationMinutes !== 'number') {
    invalid('Entry payload is invalid: sessionMetrics.durationMinutes must be a number.');
  }
  if (typeof sessionMetrics.intensity !== 'number') {
    invalid('Entry payload is invalid: sessionMetrics.intensity must be a number.');
  }
  if (typeof sessionMetrics.rounds !== 'number') {
    invalid('Entry payload is invalid: sessionMetrics.rounds must be a number.');
  }
  if (typeof sessionMetrics.giOrNoGi !== 'string') {
    invalid('Entry payload is invalid: sessionMetrics.giOrNoGi must be a string.');
  }
  if (!Array.isArray(sessionMetrics.tags) || sessionMetrics.tags.some((tag) => typeof tag !== 'string')) {
    invalid('Entry payload is invalid: sessionMetrics.tags must be an array of strings.');
  }

  if (
    payload.rawTechniqueMentions !== undefined &&
    (!Array.isArray(payload.rawTechniqueMentions) ||
      payload.rawTechniqueMentions.some((mention) => typeof mention !== 'string'))
  ) {
    invalid('Entry payload is invalid: rawTechniqueMentions must be an array of strings.');
  }

  if (!isValidMediaAttachmentsInput(payload.mediaAttachments)) {
    invalid('Entry payload is invalid: mediaAttachments must be an array of objects.');
  }

  return payload as unknown as CreateEntryRequest;
};
