import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { buildRecommendationRecord, recommendationSk } from '../../shared/curriculum';
import { resolveCurriculumAccess } from '../../shared/curriculumStore';
import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { parseUpsertRecommendationPayload } from '../../shared/recommendationPayload';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { CurriculumRecommendation } from '../../shared/types';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);

    const { athleteId, actingAsCoach } = await resolveCurriculumAccess(event, auth, ['athlete', 'coach', 'admin']);
    const recommendationId = event.pathParameters?.recommendationId?.trim().toLowerCase();
    if (!recommendationId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'recommendationId path parameter is required.',
        statusCode: 400,
      });
    }

    const payload = parseUpsertRecommendationPayload(event);

    const current = await getItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: recommendationSk(recommendationId),
      },
    });

    if (!current.Item || current.Item.entityType !== 'CURRICULUM_RECOMMENDATION') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: `Recommendation "${recommendationId}" was not found.`,
        statusCode: 404,
      });
    }

    if (actingAsCoach && !hasRole(auth, 'coach') && !hasRole(auth, 'admin')) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Only coach/admin may update recommendations for another athlete.',
        statusCode: 403,
      });
    }

    const nowIso = new Date().toISOString();
    const next: CurriculumRecommendation = {
      ...(current.Item as unknown as CurriculumRecommendation),
      ...payload,
      updatedAt: nowIso,
      ...(payload.status === 'active'
        ? {
            approvedBy: auth.userId,
            approvedAt: nowIso,
          }
        : {}),
      ...(payload.coachNote !== undefined ? { coachNote: payload.coachNote } : {}),
      ...(actingAsCoach || hasRole(auth, 'coach')
        ? { createdByRole: 'coach' as const }
        : payload.status === 'active'
          ? { createdByRole: 'athlete' as const }
          : {}),
    };

    await putItem({
      Item: buildRecommendationRecord(next),
    });

    return response(200, { recommendation: next });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateCurriculumRecommendation', baseHandler);
