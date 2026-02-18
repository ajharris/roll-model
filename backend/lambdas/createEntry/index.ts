import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { putItem } from '../../shared/db';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { CreateEntryRequest, Entry } from '../../shared/types';

const parseBody = (event: APIGatewayProxyEvent): CreateEntryRequest => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(event.body) as Partial<CreateEntryRequest>;

  if (
    !parsed.sections ||
    typeof parsed.sections.private !== 'string' ||
    typeof parsed.sections.shared !== 'string' ||
    !parsed.sessionMetrics ||
    typeof parsed.sessionMetrics.durationMinutes !== 'number' ||
    typeof parsed.sessionMetrics.intensity !== 'number' ||
    typeof parsed.sessionMetrics.rounds !== 'number' ||
    typeof parsed.sessionMetrics.giOrNoGi !== 'string' ||
    !Array.isArray(parsed.sessionMetrics.tags)
  ) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Entry payload is invalid.',
      statusCode: 400
    });
  }

  return parsed as CreateEntryRequest;
};

export const buildEntry = (
  athleteId: string,
  input: CreateEntryRequest,
  nowIso: string,
  entryId = uuidv4()
): Entry => ({
  entryId,
  athleteId,
  createdAt: nowIso,
  updatedAt: nowIso,
  sections: input.sections,
  sessionMetrics: input.sessionMetrics
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseBody(event);
    const nowIso = new Date().toISOString();
    const entry = buildEntry(auth.userId, payload, nowIso);

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `ENTRY#${entry.createdAt}#${entry.entryId}`,
        entityType: 'ENTRY',
        ...entry
      }
    });

    await putItem({
      Item: {
        PK: `ENTRY#${entry.entryId}`,
        SK: 'META',
        entityType: 'ENTRY_META',
        athleteId: auth.userId,
        createdAt: entry.createdAt
      }
    });

    return response(201, { entry });
  } catch (error) {
    return errorResponse(error);
  }
};
