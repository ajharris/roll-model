import type { Entry } from './types';

const STOPWORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'into',
  'onto',
  'your',
  'you',
  'but',
  'not',
  'have',
  'has',
  'had',
  'too',
  'very',
  'all',
  'any'
]);

export const normalizeToken = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');

export const tokenizeText = (text: string): string[] => {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => normalizeToken(word))
    .filter((word) => word.length >= 3)
    .filter((word) => !STOPWORDS.has(word));

  return [...new Set(words)];
};

export const extractEntryTokens = (
  entry: Entry,
  options: { includePrivate: boolean; maxTokens?: number }
): string[] => {
  const fromTags = entry.sessionMetrics.tags.map((tag) => normalizeToken(tag));
  const fromShared = tokenizeText(entry.sections.shared);
  const fromPrivate = options.includePrivate ? tokenizeText(entry.sections.private) : [];

  return [...new Set([...fromTags, ...fromShared, ...fromPrivate])]
    .filter((token) => token.length >= 3)
    .filter((token) => !STOPWORDS.has(token))
    .slice(0, options.maxTokens ?? 30);
};

export const buildKeywordIndexItems = (
  athleteId: string,
  entryId: string,
  createdAt: string,
  tokens: string[],
  options?: { visibilityScope?: 'shared' | 'private' }
): Array<Record<string, string>> => {
  const visibilityScope = options?.visibilityScope ?? 'shared';
  const pkPrefix = visibilityScope === 'private' ? 'USER_PRIVATE' : 'USER';
  return tokens.map((token) => ({
    PK: `${pkPrefix}#${athleteId}`,
    SK: `KW#${token}#TS#${createdAt}#ENTRY#${entryId}`,
    entityType: 'KEYWORD_INDEX',
    visibilityScope,
    entryId,
    createdAt
  }));
};
