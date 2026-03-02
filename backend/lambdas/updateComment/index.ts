import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem, queryItems } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Comment } from '../../shared/types';

type UpdatePayload = {
  body?: string;
  approvalStatus?: 'pending' | 'approved';
  gptFeedback?: {
    draft?: string;
    coachEdited?: string;
  };
};

const parseBody = (rawBody: string | null): UpdatePayload => {
  if (!rawBody) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400,
    });
  }

  const parsed = JSON.parse(rawBody) as UpdatePayload;
  if (
    parsed.body === undefined &&
    parsed.approvalStatus === undefined &&
    parsed.gptFeedback === undefined
  ) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'At least one updatable field is required.',
      statusCode: 400,
    });
  }

  return parsed;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach']);

    const commentId = event.pathParameters?.commentId;
    if (!commentId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'commentId is required.',
        statusCode: 400,
      });
    }

    const payload = parseBody(event.body);
    const metaResult = await getItem({
      Key: {
        PK: `COMMENT#${commentId}`,
        SK: 'META',
      },
    });

    if (!metaResult.Item) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Comment not found.',
        statusCode: 404,
      });
    }

    const athleteId = typeof metaResult.Item.athleteId === 'string' ? metaResult.Item.athleteId : '';
    const targetType = metaResult.Item.targetType;
    const targetId = typeof metaResult.Item.targetId === 'string' ? metaResult.Item.targetId : '';
    if (!athleteId || (targetType !== 'entry' && targetType !== 'checkoff') || !targetId) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Comment not found.',
        statusCode: 404,
      });
    }

    const link = await getItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: `COACH#${auth.userId}`,
      },
    });
    if (!isCoachLinkActive(link.Item as Record<string, unknown> | undefined)) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Coach is not linked to this athlete.',
        statusCode: 403,
      });
    }

    const pk = targetType === 'entry' ? `ENTRY#${targetId}` : `CHECKOFF#${targetId}`;
    const commentsResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':prefix': 'COMMENT#',
      },
    });

    const existingRow = (commentsResult.Items ?? []).find(
      (item) => item.entityType === 'COMMENT' && item.commentId === commentId,
    ) as (Comment & { SK: string }) | undefined;

    if (!existingRow) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Comment not found.',
        statusCode: 404,
      });
    }
    const { SK, PK: _pk, entityType: _entityType, ...existing } = existingRow as Comment & {
      PK?: string;
      SK: string;
      entityType?: string;
    };
    void _pk;
    void _entityType;

    if (existing.coachId !== auth.userId) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Only the authoring coach can edit this comment.',
        statusCode: 403,
      });
    }

    const nowIso = new Date().toISOString();
    const nextApprovalStatus =
      payload.approvalStatus ??
      existing.approval?.status ??
      (existing.approval?.requiresApproval ? 'pending' : 'approved');

    const updated: Comment = {
      ...existing,
      ...(typeof payload.body === 'string' ? { body: payload.body.trim() } : {}),
      updatedAt: nowIso,
      visibility: nextApprovalStatus === 'approved' ? 'visible' : 'hiddenByAthlete',
      approval: {
        requiresApproval: Boolean(existing.approval?.requiresApproval),
        status: nextApprovalStatus,
        ...(nextApprovalStatus === 'approved' ? { approvedAt: nowIso, approvedBy: auth.userId } : {}),
      },
      ...(payload.gptFeedback
        ? {
            gptFeedback: {
              draft:
                typeof payload.gptFeedback.draft === 'string'
                  ? payload.gptFeedback.draft
                  : existing.gptFeedback?.draft ?? '',
              ...(typeof payload.gptFeedback.coachEdited === 'string'
                ? { coachEdited: payload.gptFeedback.coachEdited }
                : existing.gptFeedback?.coachEdited
                  ? { coachEdited: existing.gptFeedback.coachEdited }
                  : {}),
            },
          }
        : {}),
    };

    await Promise.all([
      putItem({
        Item: {
          PK: pk,
          SK,
          entityType: 'COMMENT',
          ...updated,
        },
      }),
      putItem({
        Item: {
          PK: `COMMENT#${commentId}`,
          SK: 'META',
          entityType: 'COMMENT_META',
          commentId,
          athleteId,
          targetType,
          targetId,
          coachId: auth.userId,
          createdAt: existing.createdAt,
          updatedAt: nowIso,
        },
      }),
    ]);

    return response(200, { comment: updated });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateComment', baseHandler);
