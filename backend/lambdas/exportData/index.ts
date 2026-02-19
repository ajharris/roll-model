import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { queryItems } from '../../shared/db';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { AIMessage, AIThread, CoachLink, Comment, Entry } from '../../shared/types';

const SCHEMA_VERSION = '2026-02-19';
const MODE_VALUES = new Set(['full', 'tidy']);

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const mode = event.queryStringParameters?.mode?.toLowerCase();
    if (mode && !MODE_VALUES.has(mode)) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'mode must be one of: full, tidy.',
        statusCode: 400
      });
    }

    const entriesResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :entryPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${auth.userId}`,
        ':entryPrefix': 'ENTRY#'
      }
    });

    const entries = (entriesResult.Items ?? [])
      .filter((item) => item.entityType === 'ENTRY')
      .map((item) => {
        const { PK: _pk, SK: _sk, entityType: _entityType, ...entry } = item as Entry & {
          PK: string;
          SK: string;
          entityType: string;
        };
        return entry;
      });

    const commentsByEntryId = new Map<string, Comment[]>();

    await Promise.all(
      entries.map(async (entry) => {
        const commentsResult = await queryItems({
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :commentPrefix)',
          ExpressionAttributeValues: {
            ':pk': `ENTRY#${entry.entryId}`,
            ':commentPrefix': 'COMMENT#'
          }
        });

        const comments = (commentsResult.Items ?? []).map((item) => {
          const { PK: _pk, SK: _sk, entityType: _entityType, ...comment } = item as Comment & {
            PK: string;
            SK: string;
            entityType: string;
          };
          return comment;
        });

        commentsByEntryId.set(entry.entryId, comments);
      })
    );

    const [linksResult, threadsResult] = await Promise.all([
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :linkPrefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${auth.userId}`,
          ':linkPrefix': 'COACH#'
        }
      }),
      queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :threadPrefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${auth.userId}`,
          ':threadPrefix': 'AI_THREAD#'
        }
      })
    ]);

    const links = (linksResult.Items ?? [])
      .filter((item) => item.entityType === 'COACH_LINK')
      .map((item) => {
        const { PK: _pk, SK: _sk, entityType: _entityType, ...link } = item as CoachLink & {
          PK: string;
          SK: string;
          entityType: string;
        };
        return link;
      });

    const aiThreads = (threadsResult.Items ?? [])
      .filter((item) => item.entityType === 'AI_THREAD')
      .map((item) => {
        const { PK: _pk, SK: _sk, entityType: _entityType, ...thread } = item as AIThread & {
          PK: string;
          SK: string;
          entityType: string;
        };
        return thread;
      });

    const aiMessagesByThreadId = new Map<string, AIMessage[]>();
    await Promise.all(
      aiThreads.map(async (thread) => {
        const messagesResult = await queryItems({
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :msgPrefix)',
          ExpressionAttributeValues: {
            ':pk': `AI_THREAD#${thread.threadId}`,
            ':msgPrefix': 'MSG#'
          }
        });

        const messages = (messagesResult.Items ?? [])
          .filter((item) => item.entityType === 'AI_MESSAGE')
          .map((item) => {
            const { PK: _pk, SK: _sk, entityType: _entityType, ...message } = item as AIMessage & {
              PK: string;
              SK: string;
              entityType: string;
            };
            return message;
          });

        aiMessagesByThreadId.set(thread.threadId, messages);
      })
    );

    const comments = Array.from(commentsByEntryId.values()).flat();
    const aiMessages = Array.from(aiMessagesByThreadId.values()).flat();

    const fullExport = {
      athleteId: auth.userId,
      entries,
      comments,
      links,
      aiThreads,
      aiMessages
    };

    const tidyExport = {
      athlete: {
        athleteId: auth.userId
      },
      entries,
      comments,
      links,
      aiThreads,
      aiMessages,
      relationships: {
        entryComments: entries.map((entry) => ({
          entryId: entry.entryId,
          commentIds: (commentsByEntryId.get(entry.entryId) ?? []).map((comment) => comment.commentId)
        })),
        threadMessages: aiThreads.map((thread) => ({
          threadId: thread.threadId,
          messageIds: (aiMessagesByThreadId.get(thread.threadId) ?? []).map((message) => message.messageId)
        }))
      }
    };

    const payload = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      ...(mode === 'full'
        ? { full: fullExport }
        : mode === 'tidy'
          ? { tidy: tidyExport }
          : { full: fullExport, tidy: tidyExport })
    };

    return response(200, payload);
  } catch (error) {
    return errorResponse(error);
  }
};
