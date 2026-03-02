import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { relationshipSk, skillSk, progressSk } from '../../shared/curriculum';
import {
  listCurriculumSnapshot,
  listProgressSignals,
  replaceCurriculumSnapshot,
  resolveCurriculumAccess
} from '../../shared/curriculumStore';
import { assertCurriculumCompatibility, getCurriculumVersionState, runCurriculumVersionedMutation } from '../../shared/curriculumVersioning';
import { deleteItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const versionState = await getCurriculumVersionState(athleteId);
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

    const mutationResult = await runCurriculumVersionedMutation({
      athleteId,
      startedBy: auth.userId,
      sourceVersion: versionState.version,
      execute: async () => {
        const beforeSnapshot = await listCurriculumSnapshot(athleteId);
        try {
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

          const [afterSnapshot, signals] = await Promise.all([
            listCurriculumSnapshot(athleteId),
            listProgressSignals(athleteId)
          ]);
          assertCurriculumCompatibility({
            curriculumVersion: versionState.version,
            entries: signals.entries,
            recommendations: afterSnapshot.recommendations
          });
          return {
            deleted: true,
            skillId,
            removedRelationships: relatedEdges.length
          };
        } catch (error) {
          await replaceCurriculumSnapshot(athleteId, beforeSnapshot);
          throw error;
        }
      }
    });

    return response(200, { ...mutationResult.result, curriculumVersion: mutationResult.versionState });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('deleteCurriculumSkill', baseHandler);
