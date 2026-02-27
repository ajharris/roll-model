import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type {
  CheckoffEvidenceMappingStatus,
  CheckoffEvidenceType,
  CheckoffStatus,
  ConfidenceLevel,
  EvidenceQuality
} from './types';

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseBody = (event: APIGatewayProxyEvent): Record<string, unknown> => {
  const body = event.body;
  if (typeof body !== 'string') invalid('Request body is required.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(body));
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const record = asRecord(parsed);
  if (!record) invalid('Request body must be a JSON object.');
  return record as Record<string, unknown>;
};

const isConfidenceLevel = (value: unknown): value is ConfidenceLevel =>
  value === 'high' || value === 'medium' || value === 'low';

const isEvidenceType = (value: unknown): value is CheckoffEvidenceType =>
  value === 'hit-in-live-roll' ||
  value === 'hit-on-equal-or-better-partner' ||
  value === 'demonstrate-clean-reps' ||
  value === 'explain-counters-and-recounters';

const isMappingStatus = (value: unknown): value is CheckoffEvidenceMappingStatus =>
  value === 'pending_confirmation' || value === 'confirmed' || value === 'rejected';

const isCheckoffStatus = (value: unknown): value is CheckoffStatus =>
  value === 'pending' || value === 'earned' || value === 'superseded' || value === 'revalidated';

const isEvidenceQuality = (value: unknown): value is EvidenceQuality =>
  value === 'insufficient' || value === 'adequate' || value === 'strong';

const requireNonEmptyString = (value: unknown, message: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(message);
  }
  return (value as string).trim();
};

const optionalString = (value: unknown, message: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(message);
  const trimmed = (value as string).trim();
  return trimmed ? trimmed : undefined;
};

const requireConfidenceLevel = (value: unknown, message: string): ConfidenceLevel => {
  if (!isConfidenceLevel(value)) invalid(message);
  return value as ConfidenceLevel;
};

const requireEvidenceType = (value: unknown, message: string): CheckoffEvidenceType => {
  if (!isEvidenceType(value)) invalid(message);
  return value as CheckoffEvidenceType;
};

const optionalMappingStatus = (value: unknown, message: string): CheckoffEvidenceMappingStatus | undefined => {
  if (value === undefined) return undefined;
  if (!isMappingStatus(value)) invalid(message);
  return value as CheckoffEvidenceMappingStatus;
};

const optionalEvidenceQuality = (value: unknown, message: string): EvidenceQuality | undefined => {
  if (value === undefined) return undefined;
  if (!isEvidenceQuality(value)) invalid(message);
  return value as EvidenceQuality;
};

export type UpsertCheckoffEvidenceRequest = {
  evidence: Array<{
    skillId: string;
    evidenceType: CheckoffEvidenceType;
    statement: string;
    confidence: ConfidenceLevel;
    sourceOutcomeField?: string;
    mappingStatus?: CheckoffEvidenceMappingStatus;
  }>;
};

export const parseUpsertCheckoffEvidencePayload = (event: APIGatewayProxyEvent): UpsertCheckoffEvidenceRequest => {
  const payload = parseBody(event);
  const rawEvidence = payload.evidence;
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    invalid('Checkoff payload is invalid: evidence must be a non-empty array.');
  }
  const evidenceItems = rawEvidence as unknown[];

  const evidence = evidenceItems.map((raw, index) => {
    const item = asRecord(raw);
    if (!item) invalid(`Checkoff payload is invalid: evidence[${index}] must be an object.`);
    const itemRecord = item as Record<string, unknown>;

    const skillId = requireNonEmptyString(
      itemRecord.skillId,
      `Checkoff payload is invalid: evidence[${index}].skillId must be a non-empty string.`
    );
    const evidenceType = requireEvidenceType(
      itemRecord.evidenceType,
      `Checkoff payload is invalid: evidence[${index}].evidenceType is unsupported.`
    );
    const statement = requireNonEmptyString(
      itemRecord.statement,
      `Checkoff payload is invalid: evidence[${index}].statement must be a non-empty string.`
    );
    const confidence = requireConfidenceLevel(
      itemRecord.confidence,
      `Checkoff payload is invalid: evidence[${index}].confidence must be high, medium, or low.`
    );
    const sourceOutcomeField = optionalString(
      itemRecord.sourceOutcomeField,
      `Checkoff payload is invalid: evidence[${index}].sourceOutcomeField must be a string.`
    );
    const mappingStatus = optionalMappingStatus(
      itemRecord.mappingStatus,
      `Checkoff payload is invalid: evidence[${index}].mappingStatus must be pending_confirmation, confirmed, or rejected.`
    );

    return {
      skillId,
      evidenceType,
      statement,
      confidence,
      ...(sourceOutcomeField ? { sourceOutcomeField } : {}),
      ...(mappingStatus ? { mappingStatus } : {})
    };
  });

  return { evidence };
};

export type ReviewCheckoffRequest = {
  status?: CheckoffStatus;
  evidenceReviews: Array<{
    evidenceId: string;
    mappingStatus?: CheckoffEvidenceMappingStatus;
    quality?: EvidenceQuality;
    coachNote?: string;
  }>;
};

export const parseReviewCheckoffPayload = (event: APIGatewayProxyEvent): ReviewCheckoffRequest => {
  const payload = parseBody(event);

  const statusValue = payload.status;
  if (statusValue !== undefined && !isCheckoffStatus(statusValue)) {
    invalid('Checkoff review payload is invalid: status is unsupported.');
  }

  const rawEvidenceReviews = payload.evidenceReviews;
  if (!Array.isArray(rawEvidenceReviews)) {
    invalid('Checkoff review payload is invalid: evidenceReviews must be an array.');
  }
  const reviewItems = rawEvidenceReviews as unknown[];

  const evidenceReviews = reviewItems.map((raw, index) => {
    const item = asRecord(raw);
    if (!item) invalid(`Checkoff review payload is invalid: evidenceReviews[${index}] must be an object.`);
    const itemRecord = item as Record<string, unknown>;

    const evidenceId = requireNonEmptyString(
      itemRecord.evidenceId,
      `Checkoff review payload is invalid: evidenceReviews[${index}].evidenceId must be a non-empty string.`
    );
    const mappingStatus = optionalMappingStatus(
      itemRecord.mappingStatus,
      `Checkoff review payload is invalid: evidenceReviews[${index}].mappingStatus is unsupported.`
    );
    const quality = optionalEvidenceQuality(
      itemRecord.quality,
      `Checkoff review payload is invalid: evidenceReviews[${index}].quality is unsupported.`
    );
    const coachNote = optionalString(
      itemRecord.coachNote,
      `Checkoff review payload is invalid: evidenceReviews[${index}].coachNote must be a string.`
    );

    return {
      evidenceId,
      ...(mappingStatus ? { mappingStatus } : {}),
      ...(quality ? { quality } : {}),
      ...(coachNote ? { coachNote } : {})
    };
  });

  return {
    ...(isCheckoffStatus(statusValue) ? { status: statusValue } : {}),
    evidenceReviews
  };
};
