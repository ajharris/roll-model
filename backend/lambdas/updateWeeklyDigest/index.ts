import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import {
  applyWeeklyDigestEdits,
  applyWeeklyDigestSelection,
  buildWeeklyDigestMetaRecord,
  buildWeeklyDigestRecord,
  parseWeeklyDigestRecord,
  weeklyDigestMetaPk,
  weeklyDigestSk
} from '../../shared/automation';
import { parseWeeklyDigestUpdatePayload } from '../../shared/automationPayload';
import { getItem, putItem } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { WeeklyDigestArtifact } from '../../shared/types';

const requireDigestId = (value?: string): string => {
  if (!value) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'digestId is required.',
      statusCode: 400
    });
  }
  return value;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const digestId = requireDigestId(event.pathParameters?.digestId);
    const requestedAthleteId = event.pathParameters?.athleteId;
    const coachMode = Boolean(requestedAthleteId && requestedAthleteId !== auth.userId && hasRole(auth, 'coach'));
    const athleteId = requestedAthleteId ?? auth.userId;

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

    const payload = parseWeeklyDigestUpdatePayload(event);
    const nowIso = new Date().toISOString();

    const meta = await getItem({
      Key: {
        PK: weeklyDigestMetaPk(digestId),
        SK: 'META'
      }
    });

    if (
      !meta.Item ||
      meta.Item.entityType !== 'WEEKLY_DIGEST_META' ||
      typeof meta.Item.athleteId !== 'string' ||
      typeof meta.Item.weekOf !== 'string'
    ) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Weekly digest not found.',
        statusCode: 404
      });
    }

    if (meta.Item.athleteId !== athleteId) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'User does not have permission for this digest.',
        statusCode: 403
      });
    }

    const row = await getItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: weeklyDigestSk(meta.Item.weekOf, digestId)
      }
    });

    const existing = row.Item ? parseWeeklyDigestRecord(row.Item as Record<string, unknown>) : null;
    if (!existing) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Weekly digest not found.',
        statusCode: 404
      });
    }

    let updated: WeeklyDigestArtifact = applyWeeklyDigestSelection(
      existing,
      payload.selectedRecommendationIds,
      auth.userId,
      nowIso
    );

    const canCoachEdit = coachMode || hasRole(auth, 'coach');
    if (payload.recommendationEdits?.length) {
      if (!canCoachEdit) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Only coach may edit digest recommendations.',
          statusCode: 403
        });
      }
      updated = applyWeeklyDigestEdits(updated, payload.recommendationEdits, nowIso);
    }

    if (payload.coachReviewNote !== undefined) {
      if (!canCoachEdit) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Only coach may add digest review notes.',
          statusCode: 403
        });
      }

      updated = {
        ...updated,
        coachReview: {
          reviewedBy: auth.userId,
          reviewedAt: nowIso,
          ...(payload.coachReviewNote.trim() ? { notes: payload.coachReviewNote.trim() } : {})
        },
        updatedAt: nowIso
      };
    }

    await putItem({
      Item: buildWeeklyDigestRecord(updated)
    });

    await putItem({
      Item: {
        ...buildWeeklyDigestMetaRecord(updated),
        createdAt: typeof meta.Item.createdAt === 'string' ? meta.Item.createdAt : updated.generatedAt
      }
    });

    return response(200, { digest: updated });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateWeeklyDigest', baseHandler);

