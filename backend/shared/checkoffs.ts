import { v4 as uuidv4 } from 'uuid';

import type {
  ActionPack,
  ActionPackFieldKey,
  Checkoff,
  CheckoffEvidence,
  CheckoffEvidenceMappingStatus,
  CheckoffEvidenceType,
  CheckoffStatus,
  ConfidenceLevel,
  EvidenceQuality
} from './types';

type RawCheckoffEvidenceInput = {
  skillId: string;
  evidenceType: CheckoffEvidenceType;
  statement: string;
  confidence: ConfidenceLevel;
  sourceOutcomeField?: ActionPackFieldKey;
  mappingStatus?: CheckoffEvidenceMappingStatus;
};

export const CHECKOFF_MIN_EVIDENCE_POLICY: Record<CheckoffEvidenceType, number> = {
  'hit-in-live-roll': 3,
  'hit-on-equal-or-better-partner': 2,
  'demonstrate-clean-reps': 5,
  'explain-counters-and-recounters': 1
};

export const buildCheckoffId = (skillId: string, evidenceType: CheckoffEvidenceType): string =>
  `${skillId.trim().toLowerCase()}::${evidenceType}`;

export const checkoffKeyPrefix = (skillId: string, evidenceType: CheckoffEvidenceType): string =>
  `CHECKOFF#SKILL#${skillId}#TYPE#${evidenceType}`;

const normalizeSkillId = (value: string): string => value.trim().toLowerCase();

export const confidenceRank = (value: ConfidenceLevel): number => {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
};

const fieldConfidence = (actionPack: ActionPack, field: ActionPackFieldKey): ConfidenceLevel => {
  const found = actionPack.confidenceFlags.find((flag) => flag.field === field);
  return found?.confidence ?? 'medium';
};

const toPendingOrConfirmed = (confidence: ConfidenceLevel): CheckoffEvidenceMappingStatus =>
  confidence === 'low' ? 'pending_confirmation' : 'confirmed';

const uniqueNonEmpty = (values: string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export const deriveEvidenceInputsFromActionPack = (
  actionPack: ActionPack,
  skillIds: string[]
): RawCheckoffEvidenceInput[] => {
  const normalizedSkills = uniqueNonEmpty(skillIds).map(normalizeSkillId);
  if (normalizedSkills.length === 0) {
    return [];
  }

  const winsConfidence = fieldConfidence(actionPack, 'wins');
  const drillsConfidence = fieldConfidence(actionPack, 'drills');
  const positionalConfidence = fieldConfidence(actionPack, 'positionalRequests');
  const fallbackConfidence = fieldConfidence(actionPack, 'fallbackDecisionGuidance');

  const wins = uniqueNonEmpty(actionPack.wins);
  const drills = uniqueNonEmpty(actionPack.drills);
  const positional = uniqueNonEmpty(actionPack.positionalRequests);
  const fallback = actionPack.fallbackDecisionGuidance.trim();

  const collected: RawCheckoffEvidenceInput[] = [];
  for (const skillId of normalizedSkills) {
    if (wins.length > 0) {
      collected.push({
        skillId,
        evidenceType: 'hit-in-live-roll',
        statement: wins[0],
        confidence: winsConfidence,
        sourceOutcomeField: 'wins',
        mappingStatus: toPendingOrConfirmed(winsConfidence)
      });
    }

    if (drills.length > 0) {
      collected.push({
        skillId,
        evidenceType: 'demonstrate-clean-reps',
        statement: drills[0],
        confidence: drillsConfidence,
        sourceOutcomeField: 'drills',
        mappingStatus: toPendingOrConfirmed(drillsConfidence)
      });
    }

    if (positional.length > 0) {
      collected.push({
        skillId,
        evidenceType: 'hit-on-equal-or-better-partner',
        statement: positional[0],
        confidence: positionalConfidence,
        sourceOutcomeField: 'positionalRequests',
        mappingStatus: toPendingOrConfirmed(positionalConfidence)
      });
    }

    if (fallback) {
      collected.push({
        skillId,
        evidenceType: 'explain-counters-and-recounters',
        statement: fallback,
        confidence: fallbackConfidence,
        sourceOutcomeField: 'fallbackDecisionGuidance',
        mappingStatus: toPendingOrConfirmed(fallbackConfidence)
      });
    }
  }

  return collected;
};

export const createEvidenceRecord = (
  athleteId: string,
  entryId: string,
  input: RawCheckoffEvidenceInput,
  nowIso: string
): CheckoffEvidence => {
  const skillId = normalizeSkillId(input.skillId);
  const evidenceType = input.evidenceType;
  const checkoffId = buildCheckoffId(skillId, evidenceType);
  return {
    evidenceId: uuidv4(),
    checkoffId,
    athleteId,
    skillId,
    entryId,
    evidenceType,
    source: 'gpt-structured',
    statement: input.statement.trim(),
    confidence: input.confidence,
    mappingStatus: input.mappingStatus ?? toPendingOrConfirmed(input.confidence),
    sourceOutcomeField: input.sourceOutcomeField,
    createdAt: nowIso,
    updatedAt: nowIso
  };
};

const nextCheckoffStatus = (
  current: CheckoffStatus | undefined,
  confirmedEvidenceCount: number,
  minEvidenceRequired: number
): CheckoffStatus => {
  if (confirmedEvidenceCount < minEvidenceRequired) {
    return current === 'superseded' ? 'superseded' : 'pending';
  }

  if (current === 'superseded') {
    return 'revalidated';
  }

  if (current === 'revalidated') {
    return 'revalidated';
  }

  return 'earned';
};

export const mergeCheckoffFromEvidence = (
  existing: Checkoff | null,
  athleteId: string,
  skillId: string,
  evidenceType: CheckoffEvidenceType,
  allEvidenceForCheckoff: CheckoffEvidence[],
  nowIso: string,
  review?: { coachReviewedBy: string; coachReviewedAt?: string }
): Checkoff => {
  const normalizedSkill = normalizeSkillId(skillId);
  const checkoffId = buildCheckoffId(normalizedSkill, evidenceType);
  const minEvidenceRequired = CHECKOFF_MIN_EVIDENCE_POLICY[evidenceType];
  const confirmedEvidenceCount = allEvidenceForCheckoff.filter((evidence) => evidence.mappingStatus === 'confirmed').length;
  const status = nextCheckoffStatus(existing?.status, confirmedEvidenceCount, minEvidenceRequired);

  const next: Checkoff = {
    checkoffId,
    athleteId,
    skillId: normalizedSkill,
    evidenceType,
    status,
    minEvidenceRequired,
    confirmedEvidenceCount,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    ...(existing?.earnedAt ? { earnedAt: existing.earnedAt } : {}),
    ...(existing?.supersededAt ? { supersededAt: existing.supersededAt } : {}),
    ...(existing?.revalidatedAt ? { revalidatedAt: existing.revalidatedAt } : {}),
    ...(existing?.coachReviewedAt ? { coachReviewedAt: existing.coachReviewedAt } : {}),
    ...(existing?.coachReviewedBy ? { coachReviewedBy: existing.coachReviewedBy } : {})
  };

  if (status === 'earned' && !existing?.earnedAt) {
    next.earnedAt = nowIso;
  }
  if (status === 'revalidated' && !existing?.revalidatedAt) {
    next.revalidatedAt = nowIso;
  }
  if (review) {
    next.coachReviewedBy = review.coachReviewedBy;
    next.coachReviewedAt = review.coachReviewedAt ?? nowIso;
  }

  return next;
};

export const parseQuality = (value: unknown): EvidenceQuality | undefined => {
  if (value === 'insufficient' || value === 'adequate' || value === 'strong') {
    return value;
  }
  return undefined;
};
