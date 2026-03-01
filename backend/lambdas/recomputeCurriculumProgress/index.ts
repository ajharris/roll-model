import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { buildProgressAndRecommendations, buildProgressRecord } from '../../shared/curriculum';
import { listCurriculumSnapshot, listProgressSignals, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { batchWriteItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { listPersistedProgressViews } from '../../shared/progressStore';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['athlete', 'coach', 'admin']);

    const [snapshot, signals, progressViews] = await Promise.all([
      listCurriculumSnapshot(athleteId),
      listProgressSignals(athleteId),
      listPersistedProgressViews(athleteId)
    ]);

    const nowIso = new Date().toISOString();
    const built = buildProgressAndRecommendations({
      athleteId,
      skills: snapshot.skills,
      relationships: snapshot.relationships,
      checkoffs: signals.checkoffs,
      evidence: signals.evidence,
      entries: signals.entries,
      progressViews,
      existingProgress: snapshot.progressions,
      nowIso
    });

    if (built.progressions.length > 0) {
      await batchWriteItems(built.progressions.map((progress) => buildProgressRecord(progress)));
    }

    return response(200, {
      athleteId,
      generatedAt: nowIso,
      progressions: built.progressions,
      recommendations: built.recommendations
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('recomputeCurriculumProgress', baseHandler);
