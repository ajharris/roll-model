import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { normalizeId, relationshipSk } from '../../shared/curriculum';
import { listCurriculumSnapshot, listProgressSignals, replaceCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
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

    const mutationResult = await runCurriculumVersionedMutation({
      athleteId,
      startedBy: auth.userId,
      sourceVersion: versionState.version,
      execute: async () => {
        const beforeSnapshot = await listCurriculumSnapshot(athleteId);
        try {
          await deleteItem({
            Key: {
              PK: `USER#${athleteId}`,
              SK: relationshipSk(fromSkillId, toSkillId)
            }
          });

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
            fromSkillId,
            toSkillId
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

export const handler: APIGatewayProxyHandler = withRequestLogging('deleteCurriculumRelationship', baseHandler);
