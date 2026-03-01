import type { APIGatewayProxyEvent } from 'aws-lambda';

import { isValidMediaAttachmentsInput } from './entries';
import { ApiError } from './responses';
import { normalizeFinalizedSessionReview, normalizeSessionReviewArtifact } from './sessionReview';
import type {
  CreateEntryRequest,
  EntryStructuredFieldKey,
  EntryStructuredFields,
  EntryTag
} from './types';

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
const CONTEXT_TAG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STRUCTURED_FIELD_KEYS = new Set<EntryStructuredFieldKey>(['position', 'technique', 'outcome', 'problem', 'cue']);

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
  if (record === null) {
    invalid(message);
  }
  return record as Record<string, unknown>;
};

const validateTagArray = (value: unknown, fieldPath: string): void => {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    invalid(`Entry payload is invalid: ${fieldPath} must be an array of strings.`);
  }
  for (const tag of value as string[]) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || !CONTEXT_TAG_REGEX.test(normalized)) {
      invalid(
        `Entry payload is invalid: ${fieldPath} contains invalid tag "${tag}". Use lowercase kebab-case tags.`,
      );
    }
  }
};

const validateStringArray = (value: unknown, fieldPath: string): void => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid(`Entry payload is invalid: ${fieldPath} must be an array of strings.`);
  }
};

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

  if (payload.sessionContext !== undefined) {
    const sessionContext = requireRecord(payload.sessionContext, 'Entry payload is invalid: sessionContext must be an object.');
    if (sessionContext.ruleset !== undefined && typeof sessionContext.ruleset !== 'string') {
      invalid('Entry payload is invalid: sessionContext.ruleset must be a string.');
    }
    const fatigueLevel = sessionContext.fatigueLevel;
    if (fatigueLevel !== undefined) {
      if (typeof fatigueLevel !== 'number' || !Number.isFinite(fatigueLevel)) {
        invalid('Entry payload is invalid: sessionContext.fatigueLevel must be a number.');
      }
      const fatigueValue = fatigueLevel as number;
      if (fatigueValue < 1 || fatigueValue > 10) {
        invalid('Entry payload is invalid: sessionContext.fatigueLevel must be between 1 and 10.');
      }
    }
    if (sessionContext.injuryNotes !== undefined) {
      validateStringArray(sessionContext.injuryNotes, 'sessionContext.injuryNotes');
    }
    if (sessionContext.tags !== undefined) {
      validateTagArray(sessionContext.tags, 'sessionContext.tags');
    }
  }

  if (payload.partnerOutcomes !== undefined) {
    const partnerOutcomes = payload.partnerOutcomes;
    if (!Array.isArray(partnerOutcomes)) {
      invalid('Entry payload is invalid: partnerOutcomes must be an array.');
    }
    (partnerOutcomes as unknown[]).forEach((item: unknown, index: number) => {
      const partnerOutcome = requireRecord(item, `Entry payload is invalid: partnerOutcomes[${index}] must be an object.`);
      if (typeof partnerOutcome.partnerId !== 'string' || partnerOutcome.partnerId.trim().length === 0) {
        invalid(`Entry payload is invalid: partnerOutcomes[${index}].partnerId must be a non-empty string.`);
      }
      if (partnerOutcome.styleTags !== undefined) {
        validateTagArray(partnerOutcome.styleTags, `partnerOutcomes[${index}].styleTags`);
      }
      validateStringArray(partnerOutcome.whatWorked, `partnerOutcomes[${index}].whatWorked`);
      validateStringArray(partnerOutcome.whatFailed, `partnerOutcomes[${index}].whatFailed`);
      if (partnerOutcome.partnerDisplayName !== undefined && typeof partnerOutcome.partnerDisplayName !== 'string') {
        invalid(`Entry payload is invalid: partnerOutcomes[${index}].partnerDisplayName must be a string.`);
      }
      if (partnerOutcome.guidance !== undefined) {
        const guidance = requireRecord(
          partnerOutcome.guidance,
          `Entry payload is invalid: partnerOutcomes[${index}].guidance must be an object.`,
        );
        if (guidance.draft !== undefined && typeof guidance.draft !== 'string') {
          invalid(`Entry payload is invalid: partnerOutcomes[${index}].guidance.draft must be a string.`);
        }
        if (guidance.final !== undefined && typeof guidance.final !== 'string') {
          invalid(`Entry payload is invalid: partnerOutcomes[${index}].guidance.final must be a string.`);
        }
        if (guidance.coachReview !== undefined) {
          const coachReview = requireRecord(
            guidance.coachReview,
            `Entry payload is invalid: partnerOutcomes[${index}].guidance.coachReview must be an object.`,
          );
          if (coachReview.requiresReview !== undefined && typeof coachReview.requiresReview !== 'boolean') {
            invalid(
              `Entry payload is invalid: partnerOutcomes[${index}].guidance.coachReview.requiresReview must be a boolean.`,
            );
          }
          if (coachReview.coachNotes !== undefined && typeof coachReview.coachNotes !== 'string') {
            invalid(
              `Entry payload is invalid: partnerOutcomes[${index}].guidance.coachReview.coachNotes must be a string.`,
            );
          }
          if (coachReview.reviewedAt !== undefined && typeof coachReview.reviewedAt !== 'string') {
            invalid(
              `Entry payload is invalid: partnerOutcomes[${index}].guidance.coachReview.reviewedAt must be a string.`,
            );
          }
        }
      }
    });
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

  if (payload.structuredMetadataConfirmations !== undefined) {
    if (!Array.isArray(payload.structuredMetadataConfirmations)) {
      invalid('Entry payload is invalid: structuredMetadataConfirmations must be an array.');
    }
    (payload.structuredMetadataConfirmations as unknown[]).forEach((item, index) => {
      const record = requireRecord(
        item,
        `Entry payload is invalid: structuredMetadataConfirmations[${index}] must be an object.`
      );
      if (typeof record.field !== 'string' || !STRUCTURED_FIELD_KEYS.has(record.field as EntryStructuredFieldKey)) {
        invalid(
          `Entry payload is invalid: structuredMetadataConfirmations[${index}].field must be one of position, technique, outcome, problem, cue.`
        );
      }
      if (record.status !== 'confirmed' && record.status !== 'corrected' && record.status !== 'rejected') {
        invalid(
          `Entry payload is invalid: structuredMetadataConfirmations[${index}].status must be confirmed, corrected, or rejected.`
        );
      }
      if (record.correctionValue !== undefined && typeof record.correctionValue !== 'string') {
        invalid(
          `Entry payload is invalid: structuredMetadataConfirmations[${index}].correctionValue must be a string.`
        );
      }
      if (record.note !== undefined && typeof record.note !== 'string') {
        invalid(`Entry payload is invalid: structuredMetadataConfirmations[${index}].note must be a string.`);
      }
      if (record.status === 'corrected' && typeof record.correctionValue !== 'string') {
        invalid(
          `Entry payload is invalid: structuredMetadataConfirmations[${index}].correctionValue is required when status is corrected.`
        );
      }
    });
  }

  if (payload.sessionReviewDraft !== undefined && !normalizeSessionReviewArtifact(payload.sessionReviewDraft)) {
    invalid(
      'Entry payload is invalid: sessionReviewDraft must include promptSet arrays and a single concise oneThing cue.',
    );
  }

  if (payload.sessionReviewFinal !== undefined && !normalizeFinalizedSessionReview(payload.sessionReviewFinal)) {
    invalid(
      'Entry payload is invalid: sessionReviewFinal must include review promptSet arrays, a valid oneThing cue, and finalizedAt.',
    );
  }

  const normalizedDraft = normalizeSessionReviewArtifact(payload.sessionReviewDraft);
  const normalizedFinal = normalizeFinalizedSessionReview(payload.sessionReviewFinal);

  return {
    ...(payload as unknown as CreateEntryRequest),
    ...(normalizedDraft ? { sessionReviewDraft: normalizedDraft } : {}),
    ...(normalizedFinal ? { sessionReviewFinal: normalizedFinal } : {})
  };
};
