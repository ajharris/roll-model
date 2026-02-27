import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { parseSkillProgressOverride, progressSk, buildProgressRecord } from '../../shared/curriculum';
import { resolveCurriculumAccess } from '../../shared/curriculumStore';
import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { SkillProgress } from '../../shared/types';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const skillId = event.pathParameters?.skillId?.trim().toLowerCase();
    if (!skillId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'skillId path parameter is required.',
        statusCode: 400
      });
    }

    let parsedBody: unknown = {};
    if (event.body) {
      try {
        parsedBody = JSON.parse(event.body);
      } catch {
        throw new ApiError({
          code: 'INVALID_REQUEST',
          message: 'Request body must be valid JSON.',
          statusCode: 400
        });
      }
    }

    const override = parseSkillProgressOverride(parsedBody);

    const current = await getItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: progressSk(skillId)
      }
    });

    if (!current.Item || current.Item.entityType !== 'CURRICULUM_PROGRESS') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: `Progress record for skill "${skillId}" was not found. Run recompute first.`,
        statusCode: 404
      });
    }

    const nowIso = new Date().toISOString();
    const next: SkillProgress = {
      ...(current.Item as unknown as SkillProgress),
      ...override,
      coachReviewedBy: auth.userId,
      coachReviewedAt: nowIso,
      lastEvaluatedAt: nowIso
    };

    await putItem({
      Item: buildProgressRecord(next)
    });

    return response(200, { progress: next });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('reviewCurriculumProgress', baseHandler);
