import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { getCurriculumVersionState } from '../../shared/curriculumVersioning';
import { withRequestLogging } from '../../shared/logger';
import { listMigrationRuns } from '../../shared/migrationStore';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['athlete', 'coach', 'admin']);
    const [snapshot, versionState, migrationRuns] = await Promise.all([
      listCurriculumSnapshot(athleteId),
      getCurriculumVersionState(athleteId),
      listMigrationRuns(athleteId, 'curriculum-version')
    ]);

    return response(200, {
      athleteId,
      curriculumVersion: versionState,
      migrationRuns: migrationRuns.slice(0, 10),
      stages: snapshot.stages,
      skills: snapshot.skills,
      relationships: snapshot.relationships,
      progressions: snapshot.progressions,
      recommendations: snapshot.recommendations
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listCurriculum', baseHandler);
