import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { relationshipSk, skillSk, progressSk } from '../../shared/curriculum';
import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { deleteItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

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

    const snapshot = await listCurriculumSnapshot(athleteId);
    if (!snapshot.skills.some((skill) => skill.skillId === skillId)) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: `Skill "${skillId}" was not found.`,
        statusCode: 404
      });
    }

    const relatedEdges = snapshot.relationships.filter(
      (edge) => edge.fromSkillId === skillId || edge.toSkillId === skillId
    );

    await Promise.all([
      deleteItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: skillSk(skillId)
        }
      }),
      deleteItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: progressSk(skillId)
        }
      }),
      ...relatedEdges.map((edge) =>
        deleteItem({
          Key: {
            PK: `USER#${athleteId}`,
            SK: relationshipSk(edge.fromSkillId, edge.toSkillId)
          }
        })
      )
    ]);

    return response(200, {
      deleted: true,
      skillId,
      removedRelationships: relatedEdges.length
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('deleteCurriculumSkill', baseHandler);
