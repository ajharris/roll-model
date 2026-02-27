import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { buildRelationshipRecord, buildSkillRecord, buildStageRecord } from '../../shared/curriculum';
import { BASELINE_RELATIONSHIPS, BASELINE_SKILLS, BASELINE_STAGES } from '../../shared/curriculumSeed';
import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { batchWriteItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const parseForce = (rawBody: string | null): boolean => {
  if (!rawBody) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON.',
      statusCode: 400
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be an object.',
      statusCode: 400
    });
  }

  const value = (parsed as { force?: unknown }).force;
  return value === true;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const force = parseForce(event.body);

    const snapshot = await listCurriculumSnapshot(athleteId);
    if (!force && (snapshot.stages.length > 0 || snapshot.skills.length > 0 || snapshot.relationships.length > 0)) {
      throw new ApiError({
        code: 'CONFLICT',
        message: 'Curriculum already exists. Set force=true to overwrite with baseline seed.',
        statusCode: 409
      });
    }

    const nowIso = new Date().toISOString();
    const stages = BASELINE_STAGES.map((stage) => ({ ...stage, updatedAt: nowIso }));
    const skills = BASELINE_SKILLS.map((skill) => ({ ...skill, createdAt: nowIso, updatedAt: nowIso }));
    const relationships = BASELINE_RELATIONSHIPS.map((relationship) => ({
      ...relationship,
      createdAt: nowIso,
      updatedAt: nowIso
    }));

    await batchWriteItems([
      ...stages.map((stage) => buildStageRecord(athleteId, stage)),
      ...skills.map((skill) => buildSkillRecord(athleteId, skill)),
      ...relationships.map((relationship) => buildRelationshipRecord(athleteId, relationship))
    ]);

    return response(201, {
      athleteId,
      seededAt: nowIso,
      counts: {
        stages: stages.length,
        skills: skills.length,
        relationships: relationships.length
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('seedCurriculum', baseHandler);
