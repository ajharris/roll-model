import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { assertNoInvalidCycles, buildSkillRecord, normalizeSkill } from '../../shared/curriculum';
import { parseUpsertSkillPayload } from '../../shared/curriculumPayload';
import {
  listCurriculumSnapshot,
  listProgressSignals,
  replaceCurriculumSnapshot,
  resolveCurriculumAccess
} from '../../shared/curriculumStore';
import { assertCurriculumCompatibility, getCurriculumVersionState, runCurriculumVersionedMutation } from '../../shared/curriculumVersioning';
import { putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach', 'admin']);

    const { athleteId } = await resolveCurriculumAccess(event, auth, ['coach', 'admin']);
    const payload = parseUpsertSkillPayload(event, event.pathParameters?.skillId);
    const [snapshot, versionState] = await Promise.all([
      listCurriculumSnapshot(athleteId),
      getCurriculumVersionState(athleteId)
    ]);

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

    const mutationResult = await runCurriculumVersionedMutation({
      athleteId,
      startedBy: auth.userId,
      sourceVersion: versionState.version,
      execute: async () => {
        const beforeSnapshot = await listCurriculumSnapshot(athleteId);
        try {
          await putItem({
            Item: buildSkillRecord(athleteId, normalized)
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
          return normalized;
        } catch (error) {
          await replaceCurriculumSnapshot(athleteId, beforeSnapshot);
          throw error;
        }
      }
    });

    return response(200, { skill: mutationResult.result, curriculumVersion: mutationResult.versionState });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertCurriculumSkill', baseHandler);
