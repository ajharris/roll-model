import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { getPartnerProfile, parsePartnerUpsertPayload, putPartnerProfile } from '../../shared/partners';
import { ApiError, errorResponse, response } from '../../shared/responses';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const resolveAthleteId = (requestedAthleteId: string | undefined, authUserId: string): string => requestedAthleteId ?? authUserId;

const parseCoachPatch = (body: string | null): Pick<NonNullable<ReturnType<typeof asRecord>>, 'guidance'> => {
  if (!body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON.',
      statusCode: 400
    });
  }

  const payload = asRecord(parsed);
  if (!payload || payload.guidance === undefined) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Coach updates only support the guidance field.',
      statusCode: 400
    });
  }

  return { guidance: payload.guidance };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const requestedAthleteId = event.pathParameters?.athleteId;
    const coachMode = Boolean(requestedAthleteId && requestedAthleteId !== auth.userId && hasRole(auth, 'coach'));
    const athleteId = resolveAthleteId(requestedAthleteId, auth.userId);
    const partnerId = event.pathParameters?.partnerId;
    if (!athleteId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'athleteId is required for coach requests.',
        statusCode: 400
      });
    }
    if (!partnerId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'partnerId is required.',
        statusCode: 400
      });
    }

    if (coachMode) {
      const link = await getItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: `COACH#${auth.userId}`
        }
      });
      if (!isCoachLinkActive(link.Item)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403
        });
      }
    }

    const existing = await getPartnerProfile(athleteId, partnerId);
    if (!existing) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Partner not found.',
        statusCode: 404
      });
    }
    if (coachMode && existing.visibility !== 'shared-with-coach') {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Partner profile is private.',
        statusCode: 403
      });
    }

    const nowIso = new Date().toISOString();
    if (coachMode) {
      const coachPatch = parseCoachPatch(event.body);
      const guidanceRecord = asRecord(coachPatch.guidance);
      const guidance = guidanceRecord
        ? {
            ...(typeof guidanceRecord.draft === 'string' ? { draft: guidanceRecord.draft.trim() } : {}),
            ...(typeof guidanceRecord.final === 'string' ? { final: guidanceRecord.final.trim() } : {}),
            ...(asRecord(guidanceRecord.coachReview)
              ? {
                  coachReview: {
                    requiresReview: Boolean(asRecord(guidanceRecord.coachReview)?.requiresReview),
                    ...(typeof asRecord(guidanceRecord.coachReview)?.coachNotes === 'string'
                      ? { coachNotes: String(asRecord(guidanceRecord.coachReview)?.coachNotes).trim() }
                      : {}),
                    ...(typeof asRecord(guidanceRecord.coachReview)?.reviewedAt === 'string'
                      ? { reviewedAt: String(asRecord(guidanceRecord.coachReview)?.reviewedAt).trim() }
                      : {})
                  }
                }
              : {})
          }
        : existing.guidance;

      const partner = {
        ...existing,
        guidance,
        updatedAt: nowIso
      };
      await putPartnerProfile(partner);
      return response(200, { partner });
    }

    const payload = parsePartnerUpsertPayload(event.body);
    const partner = {
      ...existing,
      displayName: payload.displayName,
      styleTags: payload.styleTags,
      notes: payload.notes,
      visibility: payload.visibility ?? 'private',
      guidance: payload.guidance,
      updatedAt: nowIso
    };

    await putPartnerProfile(partner);
    return response(200, { partner });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updatePartner', baseHandler);
