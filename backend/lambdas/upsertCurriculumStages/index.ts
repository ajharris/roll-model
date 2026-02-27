import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { buildStageRecord } from '../../shared/curriculum';
import { parseCurriculumStagesPayload } from '../../shared/curriculumPayload';
import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { batchWriteItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const payload = parseCurriculumStagesPayload(event);

    const nowIso = new Date().toISOString();
    const dedupedOrders = new Set<number>();
    const stageRows = payload.stages.map((stage) => {
      if (dedupedOrders.has(stage.order)) {
        throw new ApiError({
          code: 'INVALID_REQUEST',
          message: 'Duplicate stage order values are not allowed.',
          statusCode: 400
        });
      }
      dedupedOrders.add(stage.order);
      return {
        ...stage,
        updatedAt: nowIso
      };
    });

    await batchWriteItems(stageRows.map((stage) => buildStageRecord(athleteId, stage)));

    const snapshot = await listCurriculumSnapshot(athleteId);
    return response(200, {
      athleteId,
      stages: snapshot.stages
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertCurriculumStages', baseHandler);
