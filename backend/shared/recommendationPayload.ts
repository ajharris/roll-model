import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { UpsertCurriculumRecommendationInput } from './types';

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400,
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseBody = (event: APIGatewayProxyEvent): Record<string, unknown> => {
  if (event.body == null) {
    invalid('Request body is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(event.body));
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payload = asRecord(parsed);
  if (!payload) {
    invalid('Request body must be a JSON object.');
  }

  return payload as Record<string, unknown>;
};

const optionalNonEmptyString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    invalid(`${field} must be a non-empty string.`);
  }
  return (value as string).trim();
};

export const parseUpsertRecommendationPayload = (event: APIGatewayProxyEvent): Omit<UpsertCurriculumRecommendationInput, 'recommendationId'> => {
  const payload = parseBody(event);
  const recommendationCandidate = asRecord(payload.recommendation);
  if (!recommendationCandidate) {
    invalid('recommendation must be an object.');
  }
  const recommendationRaw = recommendationCandidate as Record<string, unknown>;

  const statusRaw = recommendationRaw.status;
  if (statusRaw !== undefined && statusRaw !== 'draft' && statusRaw !== 'active' && statusRaw !== 'dismissed') {
    invalid('recommendation.status must be draft, active, or dismissed.');
  }
  const status = statusRaw as UpsertCurriculumRecommendationInput['status'] | undefined;

  const actionTypeRaw = recommendationRaw.actionType;
  if (actionTypeRaw !== undefined && actionTypeRaw !== 'drill' && actionTypeRaw !== 'concept' && actionTypeRaw !== 'skill') {
    invalid('recommendation.actionType must be drill, concept, or skill.');
  }
  const actionType = actionTypeRaw as UpsertCurriculumRecommendationInput['actionType'] | undefined;

  const actionTitle = optionalNonEmptyString(recommendationRaw.actionTitle, 'recommendation.actionTitle');
  const actionDetail = optionalNonEmptyString(recommendationRaw.actionDetail, 'recommendation.actionDetail');
  const rationale = optionalNonEmptyString(recommendationRaw.rationale, 'recommendation.rationale');
  const coachNote = optionalNonEmptyString(recommendationRaw.coachNote, 'recommendation.coachNote');

  const update: Omit<UpsertCurriculumRecommendationInput, 'recommendationId'> = {
    ...(status ? { status } : {}),
    ...(actionType ? { actionType } : {}),
    ...(actionTitle ? { actionTitle } : {}),
    ...(actionDetail ? { actionDetail } : {}),
    ...(rationale ? { rationale } : {}),
    ...(coachNote ? { coachNote } : {}),
  };

  if (Object.keys(update).length === 0) {
    invalid('recommendation update must include at least one editable field.');
  }

  return update;
};
