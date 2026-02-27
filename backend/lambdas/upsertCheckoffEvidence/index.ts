import { randomUUID } from 'crypto';

import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { parseUpsertCheckoffEvidencePayload } from '../../shared/checkoffPayload';
import { mergeCheckoffFromEvidence } from '../../shared/checkoffs';
import { getItem, putItem, queryItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Checkoff, CheckoffEvidence } from '../../shared/types';

const getEntryIdFromPath = (entryId?: string): string => {
  if (!entryId) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Entry ID is required.',
      statusCode: 400
    });
  }
  return entryId;
};

const checkoffSk = (skillId: string, evidenceType: string): string => `CHECKOFF#SKILL#${skillId}#TYPE#${evidenceType}`;

const evidenceSk = (skillId: string, evidenceType: string, createdAt: string, evidenceId: string): string =>
  `CHECKOFF#SKILL#${skillId}#TYPE#${evidenceType}#EVIDENCE#${createdAt}#${evidenceId}`;

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const entryId = getEntryIdFromPath(event.pathParameters?.entryId);
    const payload = parseUpsertCheckoffEvidencePayload(event);
    const nowIso = new Date().toISOString();

    const metaResult = await getItem({
      Key: {
        PK: `ENTRY#${entryId}`,
        SK: 'META'
      }
    });

    if (
      !metaResult.Item ||
      typeof metaResult.Item.athleteId !== 'string' ||
      typeof metaResult.Item.createdAt !== 'string'
    ) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404
      });
    }

    if (metaResult.Item.athleteId !== auth.userId) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'User does not have permission for this entry.',
        statusCode: 403
      });
    }

    const savedEvidence: CheckoffEvidence[] = [];
    const updatedCheckoffs: Checkoff[] = [];
    for (const item of payload.evidence) {
      const skillId = item.skillId.trim().toLowerCase();
      const checkoffPrefix = checkoffSk(skillId, item.evidenceType);
      const checkoffId = `${skillId}::${item.evidenceType}`;

      const evidence: CheckoffEvidence = {
        evidenceId: randomUUID(),
        checkoffId,
        athleteId: auth.userId,
        skillId,
        entryId,
        evidenceType: item.evidenceType,
        source: 'gpt-structured',
        statement: item.statement,
        confidence: item.confidence,
        mappingStatus: item.mappingStatus ?? (item.confidence === 'low' ? 'pending_confirmation' : 'confirmed'),
        sourceOutcomeField: item.sourceOutcomeField as CheckoffEvidence['sourceOutcomeField'],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await putItem({
        Item: {
          PK: `USER#${auth.userId}`,
          SK: evidenceSk(skillId, item.evidenceType, nowIso, evidence.evidenceId),
          entityType: 'CHECKOFF_EVIDENCE',
          ...evidence
        }
      });

      await putItem({
        Item: {
          PK: `ENTRY#${entryId}`,
          SK: `CHECKOFF_EVIDENCE#${auth.userId}#${checkoffId}#${evidence.evidenceId}`,
          entityType: 'ENTRY_CHECKOFF_EVIDENCE',
          athleteId: auth.userId,
          checkoffId,
          evidenceId: evidence.evidenceId,
          skillId,
          evidenceType: item.evidenceType,
          source: evidence.source,
          statement: evidence.statement,
          confidence: evidence.confidence,
          mappingStatus: evidence.mappingStatus,
          sourceOutcomeField: evidence.sourceOutcomeField,
          createdAt: evidence.createdAt,
          updatedAt: evidence.updatedAt
        }
      });

      const currentCheckoffResult = await getItem({
        Key: {
          PK: `USER#${auth.userId}`,
          SK: checkoffPrefix
        }
      });
      const existingCheckoff = currentCheckoffResult.Item && currentCheckoffResult.Item.entityType === 'CHECKOFF'
        ? (currentCheckoffResult.Item as unknown as Checkoff)
        : null;

      const evidenceRows = await queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${auth.userId}`,
          ':prefix': `${checkoffPrefix}#EVIDENCE#`
        }
      });
      const allEvidence =
        evidenceRows.Items?.filter((row) => row.entityType === 'CHECKOFF_EVIDENCE').map((row) => row as unknown as CheckoffEvidence) ?? [];

      const nextCheckoff = mergeCheckoffFromEvidence(
        existingCheckoff,
        auth.userId,
        skillId,
        item.evidenceType,
        allEvidence,
        nowIso
      );

      await putItem({
        Item: {
          PK: `USER#${auth.userId}`,
          SK: checkoffPrefix,
          entityType: 'CHECKOFF',
          ...nextCheckoff
        }
      });

      await putItem({
        Item: {
          PK: `CHECKOFF#${checkoffId}`,
          SK: 'META',
          entityType: 'CHECKOFF_META',
          athleteId: auth.userId,
          skillId,
          evidenceType: item.evidenceType
        }
      });

      savedEvidence.push(evidence);
      updatedCheckoffs.push(nextCheckoff);
    }

    return response(200, {
      checkoffs: updatedCheckoffs,
      evidence: savedEvidence,
      pendingConfirmationCount: savedEvidence.filter((item) => item.mappingStatus === 'pending_confirmation').length
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertCheckoffEvidence', baseHandler);
