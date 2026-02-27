import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { assertNoInvalidCycles, buildRelationshipRecord } from '../../shared/curriculum';
import { parseUpsertRelationshipPayload } from '../../shared/curriculumPayload';
import { listCurriculumSnapshot, resolveCurriculumAccess } from '../../shared/curriculumStore';
import { putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const payload = parseUpsertRelationshipPayload(event);
    const snapshot = await listCurriculumSnapshot(athleteId);

    if (payload.fromSkillId === payload.toSkillId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'fromSkillId and toSkillId must be different.',
        statusCode: 400
      });
    }

    if (!snapshot.skills.some((skill) => skill.skillId === payload.fromSkillId)) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `fromSkillId "${payload.fromSkillId}" does not exist.`,
        statusCode: 400
      });
    }

    if (!snapshot.skills.some((skill) => skill.skillId === payload.toSkillId)) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `toSkillId "${payload.toSkillId}" does not exist.`,
        statusCode: 400
      });
    }

    const nowIso = new Date().toISOString();
    const existing = snapshot.relationships.find(
      (item) => item.fromSkillId === payload.fromSkillId && item.toSkillId === payload.toSkillId
    );

    const relation = {
      ...payload,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso
    };

    const nextRelationships = [
      ...snapshot.relationships.filter(
        (item) => !(item.fromSkillId === relation.fromSkillId && item.toSkillId === relation.toSkillId)
      ),
      relation
    ];

    assertNoInvalidCycles(snapshot.skills, nextRelationships);

    await putItem({
      Item: buildRelationshipRecord(athleteId, relation)
    });

    return response(200, { relationship: relation });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertCurriculumRelationship', baseHandler);
