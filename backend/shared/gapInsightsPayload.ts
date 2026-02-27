import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { UpsertGapPrioritiesRequest, UpsertGapPriorityInput } from './types';

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400,
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const isStatus = (value: unknown): value is UpsertGapPriorityInput['status'] =>
  value === 'accepted' || value === 'watch' || value === 'dismissed';

export const parseUpsertGapPrioritiesPayload = (event: APIGatewayProxyEvent): UpsertGapPrioritiesRequest => {
  if (event.body == null) {
    invalid('Request body is required.');
  }
  const rawBody = String(event.body);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payloadCandidate = asRecord(parsed);
  if (!payloadCandidate) {
    invalid('Request body must be a JSON object.');
  }
  const payload = payloadCandidate as Record<string, unknown>;

  const priorityCandidates = payload.priorities;
  if (!Array.isArray(priorityCandidates) || priorityCandidates.length === 0) {
    invalid('Gap priority payload is invalid: priorities must be a non-empty array.');
  }
  const priorityArray = priorityCandidates as unknown[];

  const priorities: UpsertGapPriorityInput[] = priorityArray.map((candidate: unknown, index: number) => {
    const recordCandidate = asRecord(candidate);
    if (!recordCandidate) {
      invalid(`Gap priority payload is invalid: priorities[${index}] must be an object.`);
    }
    const record = recordCandidate as Record<string, unknown>;

    const gapIdRaw = record.gapId;
    const statusRaw = record.status;
    const manualPriority = record.manualPriority;
    const note = record.note;

    const gapId =
      typeof gapIdRaw === 'string' && gapIdRaw.trim()
        ? gapIdRaw.trim()
        : invalid(`Gap priority payload is invalid: priorities[${index}].gapId must be a non-empty string.`);

    const status: UpsertGapPriorityInput['status'] = isStatus(statusRaw)
      ? statusRaw
      : invalid(`Gap priority payload is invalid: priorities[${index}].status is unsupported.`);

    if (
      manualPriority !== undefined &&
      (typeof manualPriority !== 'number' || !Number.isInteger(manualPriority) || manualPriority < 1)
    ) {
      invalid(`Gap priority payload is invalid: priorities[${index}].manualPriority must be a positive integer.`);
    }

    if (note !== undefined && typeof note !== 'string') {
      invalid(`Gap priority payload is invalid: priorities[${index}].note must be a string.`);
    }

    return {
      gapId,
      status,
      manualPriority: typeof manualPriority === 'number' ? manualPriority : undefined,
      note: typeof note === 'string' ? note.trim() : undefined,
    };
  });

  return {
    priorities,
  };
};
