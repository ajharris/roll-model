import { getItem, queryItems } from './db';
import type { Entry } from './types';

interface KeywordMatch {
  entryId: string;
  createdAt: string;
}

export const queryKeywordMatches = async (
  userId: string,
  token: string,
  limit: number
): Promise<KeywordMatch[]> => {
  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':prefix': `KW#${token}#TS#`
    },
    ScanIndexForward: false,
    Limit: limit
  });

  return (result.Items ?? []).map((item) => ({
    entryId: String(item.entryId),
    createdAt: String(item.createdAt)
  }));
};

export const batchGetEntries = async (entryIds: string[]): Promise<Entry[]> => {
  const entries: Entry[] = [];

  for (const entryId of entryIds) {
    const meta = await getItem({
      Key: {
        PK: `ENTRY#${entryId}`,
        SK: 'META'
      }
    });

    if (!meta.Item || typeof meta.Item.athleteId !== 'string' || typeof meta.Item.createdAt !== 'string') {
      continue;
    }

    const entry = await getItem({
      Key: {
        PK: `USER#${meta.Item.athleteId}`,
        SK: `ENTRY#${meta.Item.createdAt}#${entryId}`
      }
    });

    if (!entry.Item) {
      continue;
    }

    const { PK: _pk, SK: _sk, entityType: _entityType, ...rest } = entry.Item as Entry & {
      PK: string;
      SK: string;
      entityType: string;
    };

    entries.push(rest);
  }

  return entries;
};
