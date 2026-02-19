import { getItem, putItem } from './db';
import { normalizeToken } from './keywords';
import type { TechniqueCandidate } from './types';

const TECHNIQUE_CANDIDATE_PK = 'TECHNIQUE_CANDIDATE';
const MAX_EXAMPLE_ENTRY_IDS = 10;

export const sanitizeTechniqueMentions = (mentions?: string[]): string[] => {
  if (!mentions) {
    return [];
  }

  const cleaned = mentions
    .map((mention) => mention.trim())
    .filter((mention) => mention.length > 0);

  return Array.from(new Set(cleaned));
};

export const normalizeTechniqueMention = (mention: string): string => normalizeToken(mention);

const buildCandidateItem = (
  existing: TechniqueCandidate | undefined,
  phrase: string,
  normalizedPhrase: string,
  entryId: string,
  nowIso: string
): TechniqueCandidate => {
  const existingExamples = Array.isArray(existing?.exampleEntryIds) ? existing?.exampleEntryIds : [];
  const withoutEntry = existingExamples.filter((id) => id !== entryId);
  const nextExampleEntryIds = [...withoutEntry, entryId].slice(-MAX_EXAMPLE_ENTRY_IDS);

  return {
    phrase: existing?.phrase ?? phrase,
    normalizedPhrase,
    count: (existing?.count ?? 0) + 1,
    lastSeenAt: nowIso,
    exampleEntryIds: nextExampleEntryIds,
    status: existing?.status ?? 'unmapped'
  };
};

export const upsertTechniqueCandidates = async (
  mentions: string[] | undefined,
  entryId: string,
  nowIso: string
): Promise<void> => {
  const sanitized = sanitizeTechniqueMentions(mentions);
  if (sanitized.length === 0) {
    return;
  }

  const normalizedMentions = new Map<string, string>();
  for (const mention of sanitized) {
    const normalized = normalizeTechniqueMention(mention);
    if (!normalized) {
      continue;
    }
    if (!normalizedMentions.has(normalized)) {
      normalizedMentions.set(normalized, mention);
    }
  }

  for (const [normalizedPhrase, phrase] of normalizedMentions.entries()) {
    const existingResult = await getItem({
      Key: {
        PK: TECHNIQUE_CANDIDATE_PK,
        SK: normalizedPhrase
      }
    });

    const existing = existingResult.Item
      ? (existingResult.Item as TechniqueCandidate & {
          PK: string;
          SK: string;
          entityType: string;
        })
      : undefined;

    const candidate = buildCandidateItem(existing, phrase, normalizedPhrase, entryId, nowIso);

    await putItem({
      Item: {
        PK: TECHNIQUE_CANDIDATE_PK,
        SK: normalizedPhrase,
        entityType: 'TECHNIQUE_CANDIDATE',
        ...candidate
      }
    });
  }
};

export const __test__ = {
  MAX_EXAMPLE_ENTRY_IDS
};
