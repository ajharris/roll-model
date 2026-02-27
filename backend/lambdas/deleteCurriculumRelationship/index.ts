import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { normalizeId, relationshipSk } from '../../shared/curriculum';
import { resolveCurriculumAccess } from '../../shared/curriculumStore';
import { deleteItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const fromSkillIdRaw = event.pathParameters?.fromSkillId;
    const toSkillIdRaw = event.pathParameters?.toSkillId;
    if (!fromSkillIdRaw || !toSkillIdRaw) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'fromSkillId and toSkillId path parameters are required.',
        statusCode: 400
      });
    }

    const fromSkillId = normalizeId(fromSkillIdRaw, 'fromSkillId');
    const toSkillId = normalizeId(toSkillIdRaw, 'toSkillId');

    await deleteItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: relationshipSk(fromSkillId, toSkillId)
      }
    });

    return response(200, {
      deleted: true,
      fromSkillId,
      toSkillId
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('deleteCurriculumRelationship', baseHandler);
