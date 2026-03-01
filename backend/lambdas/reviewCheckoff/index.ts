import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { parseReviewCheckoffPayload } from '../../shared/checkoffPayload';
import { mergeCheckoffFromEvidence } from '../../shared/checkoffs';
import { getItem, putItem, queryItems } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Checkoff, CheckoffEvidence, CheckoffStatus } from '../../shared/types';

const parseCheckoffId = (value?: string): { skillId: string; evidenceType: string } => {
  if (!value) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'checkoffId is required.',
      statusCode: 400
    });
  }

  const [skillId, evidenceType] = value.split('::');
  if (!skillId || !evidenceType) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'checkoffId must use "skillId::evidenceType".',
      statusCode: 400
    });
  }

  return { skillId, evidenceType };
};

const checkoffSk = (skillId: string, evidenceType: string): string => `CHECKOFF#SKILL#${skillId}#TYPE#${evidenceType}`;
const evidencePrefix = (skillId: string, evidenceType: string): string =>
  `CHECKOFF#SKILL#${skillId}#TYPE#${evidenceType}#EVIDENCE#`;

const isStatusTransitionAllowed = (from: CheckoffStatus, to: CheckoffStatus): boolean => {
  if (from === to) return true;
  if (from === 'pending' && (to === 'earned' || to === 'superseded')) return true;
  if (from === 'earned' && (to === 'superseded' || to === 'revalidated')) return true;
  if (from === 'superseded' && (to === 'revalidated' || to === 'pending')) return true;
  if (from === 'revalidated' && (to === 'superseded' || to === 'earned')) return true;
  return false;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const targetAthleteId = event.pathParameters?.athleteId ?? auth.userId;
    const { skillId, evidenceType } = parseCheckoffId(event.pathParameters?.checkoffId);
    const review = parseReviewCheckoffPayload(event);
    const nowIso = new Date().toISOString();

    const coachMode = targetAthleteId !== auth.userId;
    if (coachMode) {
      if (!hasRole(auth, 'coach')) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'User does not have permission for this action.',
          statusCode: 403
        });
      }
      const link = await getItem({
        Key: {
          PK: `USER#${targetAthleteId}`,
          SK: `COACH#${auth.userId}`
        }
      });
      if (!isCoachLinkActive(link.Item)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403
        });
      }
    }

    const checkoffKey = checkoffSk(skillId, evidenceType);
    const existingResult = await getItem({
      Key: {
        PK: `USER#${targetAthleteId}`,
        SK: checkoffKey
      }
    });

    if (!existingResult.Item || existingResult.Item.entityType !== 'CHECKOFF') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Checkoff not found.',
        statusCode: 404
      });
    }

    const existing = existingResult.Item as unknown as Checkoff;
    const evidenceRows = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${targetAthleteId}`,
        ':prefix': evidencePrefix(skillId, evidenceType)
      }
    });

    const evidenceList =
      evidenceRows.Items?.filter((item) => item.entityType === 'CHECKOFF_EVIDENCE').map((item) => item as unknown as CheckoffEvidence) ?? [];
    const reviewMap = new Map(review.evidenceReviews.map((item) => [item.evidenceId, item]));
    const updatedEvidence: CheckoffEvidence[] = [];

    for (const evidence of evidenceList) {
      const reviewItem = reviewMap.get(evidence.evidenceId);
      if (!reviewItem) {
        updatedEvidence.push(evidence);
        continue;
      }

      const nextEvidence: CheckoffEvidence = {
        ...evidence,
        ...(reviewItem.mappingStatus ? { mappingStatus: reviewItem.mappingStatus } : {}),
        ...(reviewItem.quality ? { quality: reviewItem.quality } : {}),
        ...(reviewItem.coachNote !== undefined ? { coachNote: reviewItem.coachNote } : {}),
        updatedAt: nowIso
      };
      updatedEvidence.push(nextEvidence);

      await putItem({
        Item: {
          PK: `USER#${targetAthleteId}`,
          SK: evidenceRows.Items?.find((item) => item.evidenceId === evidence.evidenceId)?.SK as string,
          entityType: 'CHECKOFF_EVIDENCE',
          ...nextEvidence
        }
      });
    }

    const nextFromEvidence = mergeCheckoffFromEvidence(
      existing,
      targetAthleteId,
      skillId,
      evidenceType as Checkoff['evidenceType'],
      updatedEvidence,
      nowIso,
      coachMode ? { coachReviewedBy: auth.userId, coachReviewedAt: nowIso } : undefined
    );

    let nextCheckoff: Checkoff = nextFromEvidence;
    if (review.status) {
      if (!isStatusTransitionAllowed(existing.status, review.status)) {
        throw new ApiError({
          code: 'INVALID_REQUEST',
          message: `Invalid checkoff status transition: ${existing.status} -> ${review.status}.`,
          statusCode: 400
        });
      }
      nextCheckoff = {
        ...nextFromEvidence,
        status: review.status,
        ...(review.status === 'superseded' ? { supersededAt: nowIso } : {}),
        ...(review.status === 'revalidated' ? { revalidatedAt: nowIso } : {})
      };
    }

    await putItem({
      Item: {
        PK: `USER#${targetAthleteId}`,
        SK: checkoffKey,
        entityType: 'CHECKOFF',
        ...nextCheckoff
      }
    });

    await recomputeAndPersistProgressViews(targetAthleteId);

    return response(200, {
      checkoff: nextCheckoff,
      evidence: updatedEvidence
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('reviewCheckoff', baseHandler);
