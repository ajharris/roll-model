import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Comment, PostCommentRequest } from '../../shared/types';

const parseBody = (rawBody: string | null): PostCommentRequest => {
  if (!rawBody) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  const parsed = JSON.parse(rawBody) as Partial<PostCommentRequest>;
  if (typeof parsed.entryId !== 'string' || typeof parsed.body !== 'string' || parsed.body.length === 0) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Comment payload is invalid.',
      statusCode: 400
    });
  }

  return parsed as PostCommentRequest;
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['coach']);

    const payload = parseBody(event.body);
    const entryMeta = await getItem({
      Key: {
        PK: `ENTRY#${payload.entryId}`,
        SK: 'META'
      }
    });

    if (!entryMeta.Item || typeof entryMeta.Item.athleteId !== 'string') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404
      });
    }

    const link = await getItem({
      Key: {
        PK: `USER#${entryMeta.Item.athleteId}`,
        SK: `COACH#${auth.userId}`
      }
    });

    if (!link.Item) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Coach is not linked to this athlete.',
        statusCode: 403
      });
    }

    const comment: Comment = {
      commentId: uuidv4(),
      entryId: payload.entryId,
      coachId: auth.userId,
      createdAt: new Date().toISOString(),
      body: payload.body,
      visibility: 'visible'
    };

    await putItem({
      Item: {
        PK: `ENTRY#${comment.entryId}`,
        SK: `COMMENT#${comment.createdAt}#${comment.commentId}`,
        entityType: 'COMMENT',
        ...comment
      }
    });

    return response(201, { comment });
  } catch (error) {
    return errorResponse(error);
  }
};
