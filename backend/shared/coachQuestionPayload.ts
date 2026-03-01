import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { CoachQuestionSetUpdateRequest } from './types';

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const parseRegenerateFlag = (event: APIGatewayProxyEvent): boolean => {
  const raw = event.queryStringParameters?.regenerate;
  if (!raw) return false;
  return raw.trim().toLowerCase() === 'true' || raw.trim() === '1';
};

export const parseCoachQuestionSetUpdatePayload = (event: APIGatewayProxyEvent): CoachQuestionSetUpdateRequest => {
  const rawBody = event.body;
  if (!rawBody) {
    invalid('Request body is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody as string);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payloadCandidate = asRecord(parsed);
  if (!payloadCandidate) {
    invalid('Request body must be a JSON object.');
  }
  const payload = payloadCandidate as Record<string, unknown>;

  const questionEdits = payload.questionEdits;
  const responses = payload.responses;
  const coachNote = payload.coachNote;

  const parsedQuestionEdits = Array.isArray(questionEdits)
    ? questionEdits.map((item, index) => {
        const recordCandidate = asRecord(item);
        if (!recordCandidate) {
          invalid(`questionEdits[${index}] must be an object.`);
        }
        const record = recordCandidate as Record<string, unknown>;

        const questionId = typeof record.questionId === 'string' ? record.questionId.trim() : '';
        const text = typeof record.text === 'string' ? record.text.trim() : '';

        if (!questionId || !text) {
          invalid(`questionEdits[${index}] must include non-empty questionId and text.`);
        }

        return {
          questionId,
          text
        };
      })
    : undefined;

  const parsedResponses = Array.isArray(responses)
    ? responses.map((item, index) => {
        const recordCandidate = asRecord(item);
        if (!recordCandidate) {
          invalid(`responses[${index}] must be an object.`);
        }
        const record = recordCandidate as Record<string, unknown>;

        const questionId = typeof record.questionId === 'string' ? record.questionId.trim() : '';
        const response = typeof record.response === 'string' ? record.response.trim() : '';

        if (!questionId || !response) {
          invalid(`responses[${index}] must include non-empty questionId and response.`);
        }

        return {
          questionId,
          response
        };
      })
    : undefined;

  if (!parsedQuestionEdits && !parsedResponses && coachNote === undefined) {
    invalid('At least one of questionEdits, responses, or coachNote must be provided.');
  }

  if (coachNote !== undefined && typeof coachNote !== 'string') {
    invalid('coachNote must be a string when provided.');
  }

  return {
    questionEdits: parsedQuestionEdits,
    responses: parsedResponses,
    coachNote: typeof coachNote === 'string' ? coachNote.trim() : undefined
  };
};
