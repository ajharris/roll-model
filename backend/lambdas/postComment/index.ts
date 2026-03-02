import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Comment, PostCommentRequest } from '../../shared/types';

const parseBody = (rawBody: string | null): PostCommentRequest => {
  if (!rawBody) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400,
    });
  }

  const parsed = JSON.parse(rawBody) as Partial<PostCommentRequest>;
  if (typeof parsed.body !== 'string' || parsed.body.trim().length === 0) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Comment payload is invalid.',
      statusCode: 400,
    });
  }

  return {
    ...parsed,
    body: parsed.body.trim(),
  } as PostCommentRequest;
};

const resolveEntryId = (entryIdFromPath: string | undefined, entryIdFromBody?: string): string | undefined => {
  if (entryIdFromPath && entryIdFromBody && entryIdFromPath !== entryIdFromBody) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Entry ID mismatch between path and body.',
      statusCode: 400,
    });
  }

  return entryIdFromPath ?? entryIdFromBody;
};

const resolveCheckoffId = (checkoffIdFromPath: string | undefined, checkoffIdFromBody?: string): string | undefined => {
  if (checkoffIdFromPath && checkoffIdFromBody && checkoffIdFromPath !== checkoffIdFromBody) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Checkoff ID mismatch between path and body.',
      statusCode: 400,
    });
  }

  return checkoffIdFromPath ?? checkoffIdFromBody;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach']);

    const payload = parseBody(event.body);
    const entryId = resolveEntryId(event.pathParameters?.entryId, payload.entryId);
    const checkoffId = resolveCheckoffId(event.pathParameters?.checkoffId, payload.checkoffId);

    if (!entryId && !checkoffId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'Either entryId or checkoffId is required.',
        statusCode: 400,
      });
    }
    if (entryId && checkoffId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'Provide exactly one target: entryId or checkoffId.',
        statusCode: 400,
      });
    }

    let athleteId: string;
    if (entryId) {
      const entryMeta = await getItem({
        Key: {
          PK: `ENTRY#${entryId}`,
          SK: 'META',
        },
      });

      if (!entryMeta.Item || typeof entryMeta.Item.athleteId !== 'string') {
        throw new ApiError({
          code: 'NOT_FOUND',
          message: 'Entry not found.',
          statusCode: 404,
        });
      }
      athleteId = entryMeta.Item.athleteId;
    } else {
      const checkoffMeta = await getItem({
        Key: {
          PK: `CHECKOFF#${checkoffId}`,
          SK: 'META',
        },
      });

      if (!checkoffMeta.Item || typeof checkoffMeta.Item.athleteId !== 'string') {
        throw new ApiError({
          code: 'NOT_FOUND',
          message: 'Checkoff not found.',
          statusCode: 404,
        });
      }
      athleteId = checkoffMeta.Item.athleteId;
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

    const nowIso = new Date().toISOString();
    const requiresApproval = Boolean(payload.requiresApproval);
    const approvalStatus = requiresApproval
      ? payload.approvalStatus === 'approved'
        ? 'approved'
        : 'pending'
      : 'approved';

    const comment: Comment = {
      commentId: uuidv4(),
      athleteId,
      entryId: entryId ?? '',
      ...(checkoffId ? { checkoffId } : {}),
      coachId: auth.userId,
      createdAt: nowIso,
      updatedAt: nowIso,
      body: payload.body,
      visibility: approvalStatus === 'approved' ? 'visible' : 'hiddenByAthlete',
      targetType: entryId ? 'entry' : 'checkoff',
      targetId: entryId ?? checkoffId,
      kind: payload.kind === 'gpt-feedback' ? 'gpt-feedback' : 'coach-note',
      approval: {
        requiresApproval,
        status: approvalStatus,
        ...(approvalStatus === 'approved' ? { approvedAt: nowIso, approvedBy: auth.userId } : {}),
      },
      ...(payload.gptFeedback && typeof payload.gptFeedback.draft === 'string'
        ? {
            gptFeedback: {
              draft: payload.gptFeedback.draft,
              ...(typeof payload.gptFeedback.coachEdited === 'string'
                ? { coachEdited: payload.gptFeedback.coachEdited }
                : {}),
            },
          }
        : {}),
    };

    const pk = entryId ? `ENTRY#${entryId}` : `CHECKOFF#${checkoffId}`;
    await Promise.all([
      putItem({
        Item: {
          PK: pk,
          SK: `COMMENT#${comment.createdAt}#${comment.commentId}`,
          entityType: 'COMMENT',
          ...comment,
        },
      }),
      putItem({
        Item: {
          PK: `COMMENT#${comment.commentId}`,
          SK: 'META',
          entityType: 'COMMENT_META',
          commentId: comment.commentId,
          targetType: comment.targetType,
          targetId: comment.targetId,
          athleteId,
          coachId: auth.userId,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        },
      }),
    ]);

    return response(201, { comment });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('postComment', baseHandler);
