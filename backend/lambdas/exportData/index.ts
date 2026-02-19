import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { queryItems } from '../../shared/db';
import { errorResponse, response } from '../../shared/responses';
import type { Comment, Entry } from '../../shared/types';

interface EntryWithComments extends Entry {
  comments: Comment[];
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

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

    const fullExport = {
      athleteId: auth.userId,
      exportedAt: new Date().toISOString(),
      entries: entries.map((entry) => ({
        ...entry,
        comments: commentsByEntryId.get(entry.entryId) ?? []
      }))
    };

    const tidyExport = {
      athlete: {
        athleteId: auth.userId
      },
      entries,
      comments: Array.from(commentsByEntryId.values()).flat(),
      relationships: {
        entryComments: entries.map((entry) => ({
          entryId: entry.entryId,
          commentIds: (commentsByEntryId.get(entry.entryId) ?? []).map((comment) => comment.commentId)
        }))
      }
    };

    return response(200, {
      full: fullExport,
      tidy: tidyExport
    });
  } catch (error) {
    return errorResponse(error);
  }
};
