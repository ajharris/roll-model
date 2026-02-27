import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['athlete', 'coach', 'admin']);
    const snapshot = await listCurriculumSnapshot(athleteId);

    return response(200, {
      athleteId,
      stages: snapshot.stages,
      skills: snapshot.skills,
      relationships: snapshot.relationships,
      progressions: snapshot.progressions
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listCurriculum', baseHandler);
