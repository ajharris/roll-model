import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { assertNoInvalidCycles, buildSkillRecord, normalizeSkill } from '../../shared/curriculum';
import { parseUpsertSkillPayload } from '../../shared/curriculumPayload';
import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const payload = parseUpsertSkillPayload(event, event.pathParameters?.skillId);
    const snapshot = await listCurriculumSnapshot(athleteId);

    if (!snapshot.stages.some((stage) => stage.stageId === payload.stageId)) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `stageId "${payload.stageId}" does not exist.`,
        statusCode: 400
      });
    }

    const nowIso = new Date().toISOString();
    const existing = snapshot.skills.find((skill) => skill.skillId === payload.skillId);
    const normalized = normalizeSkill({
      ...payload,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso
    });

    const nextSkills = [
      ...snapshot.skills.filter((skill) => skill.skillId !== normalized.skillId),
      normalized
    ];

    assertNoInvalidCycles(nextSkills, snapshot.relationships);

    await putItem({
      Item: buildSkillRecord(athleteId, normalized)
    });

    return response(200, { skill: normalized });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertCurriculumSkill', baseHandler);
