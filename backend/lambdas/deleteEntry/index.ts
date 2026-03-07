import type { APIGatewayProxyHandler, Context } from 'aws-lambda';


import { buildActionPackDeleteKeys } from '../../shared/actionPackIndex';
import { getAuthContext, requireRole } from '../../shared/auth';
import { deleteItem, getItem, queryItems } from '../../shared/db';
import { parseEntryRecord } from '../../shared/entries';
import { extractEntryTokens } from '../../shared/keywords';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { Entry } from '../../shared/types';

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

const buildKeywordDeleteKeys = (entry: Entry): Array<{ PK: string; SK: string }> => {
  const sharedTokens = extractEntryTokens(entry, { includePrivate: false, maxTokens: 30 });
  const allTokens = extractEntryTokens(entry, { includePrivate: true, maxTokens: 30 });
  const sharedSet = new Set(sharedTokens);
  const privateOnlyTokens = allTokens.filter((token) => !sharedSet.has(token));

  return [
    ...sharedTokens.map((token) => ({
      PK: `USER#${entry.athleteId}`,
      SK: `KW#${token}#TS#${entry.createdAt}#ENTRY#${entry.entryId}`
    })),
    ...privateOnlyTokens.map((token) => ({
      PK: `USER_PRIVATE#${entry.athleteId}`,
      SK: `KW#${token}#TS#${entry.createdAt}#ENTRY#${entry.entryId}`
    }))
  ];
};

const safeDelete = async (key: { PK: string; SK: string }, context: string): Promise<void> => {
  try {
    await deleteItem({ Key: key });
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: 'deleteEntry.cleanup.delete_failed',
        context,
        key,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) }
      })
    );
  }
};

const toErrorDetails = (error: unknown): { name?: string; message: string; stack?: string } =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

const baseHandler: APIGatewayProxyHandler = async (event, context: Context) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const entryId = getEntryIdFromPath(event.pathParameters?.entryId);

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

    const entryKey = {
      PK: `USER#${auth.userId}`,
      SK: `ENTRY#${metaResult.Item.createdAt}#${entryId}`
    };

    const entryResult = await getItem({ Key: entryKey });
    if (!entryResult.Item || entryResult.Item.entityType !== 'ENTRY') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Entry not found.',
        statusCode: 404
      });
    }

    let parsedEntry: Entry | null = null;
    try {
      parsedEntry = parseEntryRecord(entryResult.Item as Record<string, unknown>);
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: 'deleteEntry.cleanup.parse_entry_failed',
          entryId,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) }
        })
      );
    }

    try {
      const commentsResult = await queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :commentPrefix)',
        ExpressionAttributeValues: {
          ':pk': `ENTRY#${entryId}`,
          ':commentPrefix': 'COMMENT#'
        }
      });

      for (const item of commentsResult.Items ?? []) {
        if (typeof item.PK === 'string' && typeof item.SK === 'string') {
          await safeDelete(
            {
              PK: item.PK,
              SK: item.SK
            },
            'comment_item'
          );
          if (typeof item.commentId === 'string') {
            await safeDelete(
              {
                PK: `COMMENT#${item.commentId}`,
                SK: 'META'
              },
              'comment_meta'
            );
          }
        }
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: 'deleteEntry.cleanup.query_comments_failed',
          entryId,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) }
        })
      );
    }

    if (parsedEntry) {
      try {
        for (const key of buildKeywordDeleteKeys(parsedEntry)) {
          await safeDelete(key, 'keyword_index');
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            msg: 'deleteEntry.cleanup.keyword_index_build_failed',
            entryId,
            error: toErrorDetails(error)
          })
        );
      }
      try {
        for (const key of buildActionPackDeleteKeys(parsedEntry)) {
          await safeDelete(key, 'action_pack_index');
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            msg: 'deleteEntry.cleanup.action_pack_index_build_failed',
            entryId,
            error: toErrorDetails(error)
          })
        );
      }
    }

    try {
      await deleteItem({ Key: entryKey });
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: 'deleteEntry.primary_delete_failed',
          entryId,
          context: 'entry_row',
          key: entryKey,
          error: toErrorDetails(error)
        })
      );
      throw error;
    }
    const metaKey = {
      PK: `ENTRY#${entryId}`,
      SK: 'META'
    };
    try {
      await deleteItem({ Key: metaKey });
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: 'deleteEntry.primary_delete_failed',
          entryId,
          context: 'entry_meta',
          key: metaKey,
          error: toErrorDetails(error)
        })
      );
      throw error;
    }

    return response(204, {});
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error(
        JSON.stringify({
          msg: 'deleteEntry.unhandled_error',
          entryId: event.pathParameters?.entryId,
          error: toErrorDetails(error)
        })
      );
      return response(500, {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred.',
          requestId: event.requestContext?.requestId ?? context.awsRequestId
        }
      });
    }
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('deleteEntry', baseHandler);
