import { getItem, queryItems } from './db';
import type { Entry } from './types';

interface KeywordMatch {
  entryId: string;
  createdAt: string;
}

export const queryKeywordMatches = async (
  userId: string,
  token: string,
  limit: number,
  options?: { visibilityScope?: 'shared' | 'private' }
): Promise<KeywordMatch[]> => {
  const visibilityScope = options?.visibilityScope ?? 'shared';
  const pkPrefix = visibilityScope === 'private' ? 'USER_PRIVATE' : 'USER';
  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `${pkPrefix}#${userId}`,
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

export const rankKeywordMatches = (matches: KeywordMatch[][], limit: number): string[] => {
  const ranked = new Map<string, { score: number; createdAt: string }>();
  for (const perToken of matches) {
    for (const match of perToken) {
      const current = ranked.get(match.entryId);
      const latestCreatedAt =
        !current || match.createdAt > current.createdAt ? match.createdAt : current.createdAt;
      ranked.set(match.entryId, {
        score: (current?.score ?? 0) + 1,
        createdAt: latestCreatedAt
      });
    }
  }

  return Array.from(ranked.entries())
    .sort((a, b) => {
      if (b[1].score !== a[1].score) {
        return b[1].score - a[1].score;
      }
      return b[1].createdAt.localeCompare(a[1].createdAt);
    })
    .map(([entryId]) => entryId)
    .slice(0, limit);
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
