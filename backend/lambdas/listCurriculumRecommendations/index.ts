import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import {
  buildProgressAndRecommendations,
  buildProgressRecord,
  buildRecommendationRecord,
} from '../../shared/curriculum';
import { listCurriculumSnapshot, listProgressSignals, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { batchWriteItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { listPersistedProgressViews } from '../../shared/progressStore';
import { errorResponse, response } from '../../shared/responses';

const shouldRefresh = (value: string | undefined): boolean => {
  if (!value) return true;
  return value.trim().toLowerCase() !== 'false';
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['athlete', 'coach', 'admin']);
    const refresh = shouldRefresh(event.queryStringParameters?.refresh);

    const [snapshot, signals, progressViews] = await Promise.all([
      listCurriculumSnapshot(athleteId),
      refresh ? listProgressSignals(athleteId) : Promise.resolve(null),
      refresh ? listPersistedProgressViews(athleteId) : Promise.resolve(null),
    ]);

    if (!refresh) {
      return response(200, {
        athleteId,
        generatedAt: new Date().toISOString(),
        recommendations: snapshot.recommendations,
      });
    }

    const nowIso = new Date().toISOString();
    const built = buildProgressAndRecommendations({
      athleteId,
      skills: snapshot.skills,
      relationships: snapshot.relationships,
      checkoffs: signals?.checkoffs ?? [],
      evidence: signals?.evidence ?? [],
      entries: signals?.entries ?? [],
      progressViews,
      existingProgress: snapshot.progressions,
      existingRecommendations: snapshot.recommendations,
      nowIso,
    });

    const rowsToPersist = [
      ...built.progressions.map((progress) => buildProgressRecord(progress)),
      ...built.recommendations.map((recommendation) => buildRecommendationRecord(recommendation)),
    ];
    if (rowsToPersist.length > 0) {
      await batchWriteItems(rowsToPersist);
    }

    return response(200, {
      athleteId,
      generatedAt: nowIso,
      recommendations: built.recommendations,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listCurriculumRecommendations', baseHandler);
