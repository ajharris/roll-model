import type { APIGatewayProxyHandler } from 'aws-lambda';


import { buildActionPackDeleteKeys } from '../../shared/actionPackIndex';
import { getAuthContext, requireRole } from '../../shared/auth';
import { deleteItem, getItem, queryItems } from '../../shared/db';
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

const stripEntryKeys = (item: Record<string, unknown>): Entry => {
  const { PK: _pk, SK: _sk, entityType: _entityType, ...entry } = item as unknown as Entry & {
    PK: string;
    SK: string;
    entityType: string;
  };
  void _pk;
  void _sk;
  void _entityType;
  return entry;
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

const baseHandler: APIGatewayProxyHandler = async (event) => {
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

    const entry = stripEntryKeys(entryResult.Item as Record<string, unknown>);

    const commentsResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :commentPrefix)',
      ExpressionAttributeValues: {
        ':pk': `ENTRY#${entryId}`,
        ':commentPrefix': 'COMMENT#'
      }
    });

    for (const item of commentsResult.Items ?? []) {
      if (typeof item.PK === 'string' && typeof item.SK === 'string') {
        await deleteItem({
          Key: {
            PK: item.PK,
            SK: item.SK
          }
        });
        if (typeof item.commentId === 'string') {
          await deleteItem({
            Key: {
              PK: `COMMENT#${item.commentId}`,
              SK: 'META'
            }
          });
        }
      }
    }

    for (const key of buildKeywordDeleteKeys(entry)) {
      await deleteItem({ Key: key });
    }
    for (const key of buildActionPackDeleteKeys(entry)) {
      await deleteItem({ Key: key });
    }

    await deleteItem({ Key: entryKey });
    await deleteItem({
      Key: {
        PK: `ENTRY#${entryId}`,
        SK: 'META'
      }
    });

    return response(204, {});
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('deleteEntry', baseHandler);
