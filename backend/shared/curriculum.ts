import { ApiError } from './responses';
import type {
  Entry,
  Checkoff,
  CheckoffEvidence,
  Skill,
  SkillProgress,
  SkillRelationship,
  CurriculumStage,
  CurriculumRecommendation,
  SkillCategory,
  SkillProgressState,
  ConfidenceLevel,
  ProgressViewsReport,
} from './types';

export const CURRICULUM_STAGE_PREFIX = 'CURRICULUM_STAGE#';
export const CURRICULUM_SKILL_PREFIX = 'CURRICULUM_SKILL#';
export const CURRICULUM_REL_PREFIX = 'CURRICULUM_REL#FROM#';
export const CURRICULUM_PROGRESS_PREFIX = 'CURRICULUM_PROGRESS#';
export const CURRICULUM_RECOMMENDATION_PREFIX = 'CURRICULUM_RECOMMENDATION#';

const SKILL_CATEGORIES: SkillCategory[] = [
  'escape',
  'pass',
  'guard-retention',
  'sweep',
  'submission',
  'takedown',
  'control',
  'transition',
  'concept',
  'other',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400,
  });
};

export const normalizeId = (value: string, fieldName: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    invalid(`${fieldName} must include letters or numbers.`);
  }

  return normalized;
};

const normalizeTextToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeStringList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const scoreTrendBoost = (skill: Skill, progressViews?: ProgressViewsReport | null): { boost: number; notes: string[] } => {
  if (!progressViews) {
    return { boost: 0, notes: [] };
  }

  const trendPoint = progressViews.outcomeTrends.points[progressViews.outcomeTrends.points.length - 1];
  const neglectedPositions = progressViews.positionHeatmap.cells.filter((cell) => cell.neglected).map((cell) => cell.position);
  const notes: string[] = [];
  let boost = 0;

  if (skill.category === 'escape' && trendPoint?.escapesSuccessRate !== null && trendPoint?.escapesSuccessRate !== undefined) {
    if (trendPoint.escapesSuccessRate < 0.5) {
      boost += 15;
      notes.push(`Escape success trend is ${(trendPoint.escapesSuccessRate * 100).toFixed(0)}%.`);
    }
  }

  if (
    skill.category === 'guard-retention' &&
    trendPoint?.guardRetentionFailureRate !== null &&
    trendPoint?.guardRetentionFailureRate !== undefined
  ) {
    if (trendPoint.guardRetentionFailureRate > 0.4) {
      boost += 20;
      notes.push(`Guard retention failure trend is ${(trendPoint.guardRetentionFailureRate * 100).toFixed(0)}%.`);
    }
  }

  const skillName = skill.name.toLowerCase();
  if (neglectedPositions.some((position) => skillName.includes(position))) {
    boost += 10;
    notes.push('Matches a neglected position in recent sessions.');
  }

  return { boost, notes };
};

const daysSince = (iso: string | undefined, nowMs: number): number => {
  if (!iso) return 120;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(0, Math.floor((nowMs - parsed) / DAY_MS));
};

const recommendationKey = (skillId: string, actionType: CurriculumRecommendation['actionType'], actionTitle: string): string =>
  `${normalizeId(skillId, 'skillId')}:${actionType}:${normalizeId(actionTitle || 'step', 'actionTitle')}`;

export const normalizeSkill = (skill: Skill): Skill => {
  if (!SKILL_CATEGORIES.includes(skill.category)) {
    invalid('skill category is invalid.');
  }

  return {
    ...skill,
    skillId: normalizeId(skill.skillId, 'skillId'),
    name: skill.name.trim(),
    stageId: normalizeId(skill.stageId, 'stageId'),
    prerequisites: normalizeStringList(skill.prerequisites).map((item) => normalizeId(item, 'prerequisites[]')),
    keyConcepts: normalizeStringList(skill.keyConcepts),
    commonFailures: normalizeStringList(skill.commonFailures),
    drills: normalizeStringList(skill.drills),
  };
};

export const stageSk = (stageId: string, order: number): string =>
  `${CURRICULUM_STAGE_PREFIX}${String(order).padStart(2, '0')}#${normalizeId(stageId, 'stageId')}`;

export const skillSk = (skillId: string): string => `${CURRICULUM_SKILL_PREFIX}${normalizeId(skillId, 'skillId')}`;

export const relationshipSk = (fromSkillId: string, toSkillId: string): string =>
  `${CURRICULUM_REL_PREFIX}${normalizeId(fromSkillId, 'fromSkillId')}#TO#${normalizeId(toSkillId, 'toSkillId')}`;

export const progressSk = (skillId: string): string => `${CURRICULUM_PROGRESS_PREFIX}${normalizeId(skillId, 'skillId')}`;

export const recommendationSk = (recommendationId: string): string =>
  `${CURRICULUM_RECOMMENDATION_PREFIX}${normalizeId(recommendationId, 'recommendationId')}`;

export const buildStageRecord = (athleteId: string, stage: CurriculumStage): Record<string, unknown> => ({
  PK: `USER#${athleteId}`,
  SK: stageSk(stage.stageId, stage.order),
  entityType: 'CURRICULUM_STAGE',
  GSI1PK: `CURRICULUM_STAGE#${normalizeId(stage.stageId, 'stageId')}`,
  GSI1SK: `ORDER#${String(stage.order).padStart(2, '0')}`,
  ...stage,
});

export const buildSkillRecord = (athleteId: string, skill: Skill): Record<string, unknown> => ({
  PK: `USER#${athleteId}`,
  SK: skillSk(skill.skillId),
  entityType: 'CURRICULUM_SKILL',
  GSI1PK: `CURRICULUM_STAGE#${normalizeId(skill.stageId, 'stageId')}`,
  GSI1SK: `SKILL#${skill.name.toLowerCase()}#${normalizeId(skill.skillId, 'skillId')}`,
  ...skill,
});

export const buildRelationshipRecord = (athleteId: string, relationship: SkillRelationship): Record<string, unknown> => ({
  PK: `USER#${athleteId}`,
  SK: relationshipSk(relationship.fromSkillId, relationship.toSkillId),
  entityType: 'CURRICULUM_RELATIONSHIP',
  GSI1PK: `CURRICULUM_DEPENDS_ON#${normalizeId(relationship.toSkillId, 'toSkillId')}`,
  GSI1SK: `SKILL#${normalizeId(relationship.fromSkillId, 'fromSkillId')}`,
  ...relationship,
});

export const buildProgressRecord = (progress: SkillProgress): Record<string, unknown> => ({
  PK: `USER#${progress.athleteId}`,
  SK: progressSk(progress.skillId),
  entityType: 'CURRICULUM_PROGRESS',
  ...progress,
});

export const buildRecommendationRecord = (recommendation: CurriculumRecommendation): Record<string, unknown> => ({
  PK: `USER#${recommendation.athleteId}`,
  SK: recommendationSk(recommendation.recommendationId),
  entityType: 'CURRICULUM_RECOMMENDATION',
  ...recommendation,
});

export type CurriculumSnapshot = {
  stages: CurriculumStage[];
  skills: Skill[];
  relationships: SkillRelationship[];
  progressions: SkillProgress[];
  recommendations: CurriculumRecommendation[];
};

export const parseCurriculumSnapshot = (items: Array<Record<string, unknown>>): CurriculumSnapshot => {
  const stages: CurriculumStage[] = [];
  const skills: Skill[] = [];
  const relationships: SkillRelationship[] = [];
  const progressions: SkillProgress[] = [];
  const recommendations: CurriculumRecommendation[] = [];

  for (const item of items) {
    if (
      item.entityType === 'CURRICULUM_STAGE' &&
      typeof item.stageId === 'string' &&
      typeof item.name === 'string' &&
      typeof item.order === 'number' &&
      Array.isArray(item.milestoneSkills) &&
      typeof item.updatedAt === 'string'
    ) {
      stages.push(item as unknown as CurriculumStage);
    }
    if (
      item.entityType === 'CURRICULUM_SKILL' &&
      typeof item.skillId === 'string' &&
      typeof item.name === 'string' &&
      typeof item.category === 'string' &&
      typeof item.stageId === 'string' &&
      Array.isArray(item.prerequisites) &&
      Array.isArray(item.keyConcepts) &&
      Array.isArray(item.commonFailures) &&
      Array.isArray(item.drills) &&
      typeof item.createdAt === 'string' &&
      typeof item.updatedAt === 'string'
    ) {
      skills.push(item as unknown as Skill);
    }
    if (
      item.entityType === 'CURRICULUM_RELATIONSHIP' &&
      typeof item.fromSkillId === 'string' &&
      typeof item.toSkillId === 'string' &&
      typeof item.relation === 'string' &&
      typeof item.createdAt === 'string' &&
      typeof item.updatedAt === 'string'
    ) {
      relationships.push(item as unknown as SkillRelationship);
    }
    if (
      item.entityType === 'CURRICULUM_PROGRESS' &&
      typeof item.athleteId === 'string' &&
      typeof item.skillId === 'string' &&
      typeof item.state === 'string' &&
      typeof item.evidenceCount === 'number' &&
      typeof item.confidence === 'string' &&
      Array.isArray(item.rationale) &&
      Array.isArray(item.sourceEntryIds) &&
      Array.isArray(item.sourceEvidenceIds) &&
      Array.isArray(item.suggestedNextSkillIds) &&
      typeof item.lastEvaluatedAt === 'string'
    ) {
      progressions.push(item as unknown as SkillProgress);
    }
    if (
      item.entityType === 'CURRICULUM_RECOMMENDATION' &&
      typeof item.athleteId === 'string' &&
      typeof item.recommendationId === 'string' &&
      typeof item.skillId === 'string' &&
      typeof item.actionType === 'string' &&
      typeof item.actionTitle === 'string' &&
      typeof item.status === 'string' &&
      typeof item.score === 'number' &&
      typeof item.rationale === 'string' &&
      Array.isArray(item.sourceEvidence) &&
      typeof item.generatedAt === 'string' &&
      typeof item.updatedAt === 'string'
    ) {
      recommendations.push(item as unknown as CurriculumRecommendation);
    }
  }

  stages.sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name) : a.order - b.order));
  skills.sort((a, b) => a.name.localeCompare(b.name));
  recommendations.sort((a, b) => (a.score === b.score ? a.actionTitle.localeCompare(b.actionTitle) : b.score - a.score));

  return { stages, skills, relationships, progressions, recommendations };
};

const buildPrereqAdjacency = (skills: Skill[], relationships: SkillRelationship[]): Map<string, Set<string>> => {
  const adjacency = new Map<string, Set<string>>();

  for (const skill of skills) {
    adjacency.set(skill.skillId, new Set(skill.prerequisites));
  }

  for (const relation of relationships) {
    if (relation.relation !== 'prerequisite') continue;
    const set = adjacency.get(relation.fromSkillId) ?? new Set<string>();
    set.add(relation.toSkillId);
    adjacency.set(relation.fromSkillId, set);
  }

  return adjacency;
};

export const assertNoInvalidCycles = (skills: Skill[], relationships: SkillRelationship[]): void => {
  const adjacency = buildPrereqAdjacency(skills, relationships);
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      invalid('Invalid curriculum dependency cycle detected in prerequisite relationships.');
    }

    visiting.add(nodeId);
    const next = adjacency.get(nodeId) ?? new Set<string>();
    for (const target of next) {
      visit(target);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const skill of skills) {
    visit(skill.skillId);
  }
};

const confidenceFromEvidenceCount = (count: number): ConfidenceLevel => {
  if (count >= 4) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
};

const stateFromSignals = (
  evidenceCount: number,
  checkoffPendingCount: number,
  checkoffEarnedCount: number,
  blockedByPrereq: boolean,
): SkillProgressState => {
  if (blockedByPrereq) return 'blocked';
  if (checkoffEarnedCount > 0) return 'complete';
  if (evidenceCount >= 3) return checkoffPendingCount > 0 ? 'ready_for_review' : 'evidence_present';
  if (evidenceCount > 0 || checkoffPendingCount > 0) return 'working';
  return 'not_started';
};

type BuildProgressInput = {
  athleteId: string;
  skills: Skill[];
  relationships: SkillRelationship[];
  checkoffs: Checkoff[];
  evidence: CheckoffEvidence[];
  entries: Entry[];
  progressViews?: ProgressViewsReport | null;
  existingProgress?: SkillProgress[];
  existingRecommendations?: CurriculumRecommendation[];
  nowIso: string;
};

type FailureSignal = {
  entryId: string;
  createdAt: string;
  excerpt: string;
};

const extractFailureSignals = (entries: Entry[]): FailureSignal[] => {
  const signals: FailureSignal[] = [];
  for (const entry of entries) {
    const actionPack = entry.actionPackFinal?.actionPack ?? entry.actionPackDraft;
    if (actionPack) {
      for (const leak of actionPack.leaks) {
        const text = leak.trim();
        if (!text) continue;
        signals.push({
          entryId: entry.entryId,
          createdAt: entry.createdAt,
          excerpt: text,
        });
      }
      const oneFocus = actionPack.oneFocus.trim();
      if (oneFocus) {
        signals.push({
          entryId: entry.entryId,
          createdAt: entry.createdAt,
          excerpt: oneFocus,
        });
      }
    }

    const sessionReview = entry.sessionReviewFinal?.review ?? entry.sessionReviewDraft;
    if (sessionReview) {
      for (const failed of sessionReview.promptSet.whatFailed) {
        const text = failed.trim();
        if (!text) continue;
        signals.push({
          entryId: entry.entryId,
          createdAt: entry.createdAt,
          excerpt: text,
        });
      }
    }
  }

  return signals;
};

const selectSmallestAction = (skill: Skill, matchedFailureText: string[]): Pick<CurriculumRecommendation, 'actionType' | 'actionTitle' | 'actionDetail'> => {
  const joined = matchedFailureText.join(' ').toLowerCase();
  const matchingDrill = skill.drills.find((drill) => {
    const token = normalizeTextToken(drill);
    return token.length > 0 && joined.includes(token);
  });

  if (matchingDrill || skill.drills.length > 0) {
    const drill = matchingDrill ?? skill.drills[0];
    return {
      actionType: 'drill',
      actionTitle: drill,
      actionDetail: `Run short reps on ${drill} to directly target this recurring failure.`,
    };
  }

  if (skill.keyConcepts.length > 0) {
    return {
      actionType: 'concept',
      actionTitle: skill.keyConcepts[0],
      actionDetail: `Reinforce ${skill.keyConcepts[0]} before adding complexity.`,
    };
  }

  return {
    actionType: 'skill',
    actionTitle: skill.name,
    actionDetail: `Keep training ${skill.name} with constrained rounds until failure frequency drops.`,
  };
};

const buildCurriculumRecommendations = (input: {
  athleteId: string;
  nowIso: string;
  skills: Skill[];
  relationships: SkillRelationship[];
  progressions: SkillProgress[];
  evidence: CheckoffEvidence[];
  entries: Entry[];
  progressViews?: ProgressViewsReport | null;
  existingRecommendations?: CurriculumRecommendation[];
}): CurriculumRecommendation[] => {
  const nowMs = Date.parse(input.nowIso);
  const progressBySkill = new Map(input.progressions.map((item) => [item.skillId, item] as const));
  const prereqBySkill = buildPrereqAdjacency(input.skills, input.relationships);
  const existingById = new Map(
    (input.existingRecommendations ?? []).map((recommendation) => [recommendation.recommendationId, recommendation] as const),
  );

  const evidenceBySkill = new Map<string, CheckoffEvidence[]>();
  for (const row of input.evidence) {
    if (row.mappingStatus === 'rejected') continue;
    const current = evidenceBySkill.get(row.skillId) ?? [];
    current.push(row);
    evidenceBySkill.set(row.skillId, current);
  }

  const failureSignals = extractFailureSignals(input.entries).map((signal) => ({
    ...signal,
    normalized: normalizeTextToken(signal.excerpt),
  }));

  const recommendations: CurriculumRecommendation[] = [];

  for (const skill of input.skills) {
    const progress = progressBySkill.get(skill.skillId);
    if (!progress || progress.state === 'complete') {
      continue;
    }

    const skillTerms = normalizeStringList([skill.name, ...skill.commonFailures, ...skill.keyConcepts]).map(normalizeTextToken);
    const matchedFailures = failureSignals.filter((signal) => skillTerms.some((term) => term.length > 2 && signal.normalized.includes(term)));

    const relevantEvidence = (evidenceBySkill.get(skill.skillId) ?? []).slice(0, 3);
    const missingPrerequisiteSkillIds = [...(prereqBySkill.get(skill.skillId) ?? new Set<string>())].filter(
      (prereqSkillId) => progressBySkill.get(prereqSkillId)?.state !== 'complete',
    );

    const supportingNextSkillIds = input.relationships
      .filter((relation) => relation.fromSkillId === skill.skillId)
      .map((relation) => relation.toSkillId)
      .filter((target, index, all) => all.indexOf(target) === index);

    const trend = scoreTrendBoost(skill, input.progressViews);
    const failureCount = matchedFailures.length;
    const evidenceCount = relevantEvidence.length;
    const recencyDays = matchedFailures.length > 0 ? Math.min(...matchedFailures.map((item) => daysSince(item.createdAt, nowMs))) : 120;

    if (failureCount === 0 && evidenceCount === 0 && missingPrerequisiteSkillIds.length === 0 && trend.boost === 0) {
      continue;
    }

    const action = selectSmallestAction(
      skill,
      matchedFailures.map((item) => item.excerpt),
    );

    const relevanceScore = clamp(
      Math.round(failureCount * 14 + evidenceCount * 8 + (recencyDays <= 7 ? 12 : recencyDays <= 21 ? 7 : 3) + trend.boost),
      5,
      100,
    );
    const impactScore = clamp(
      Math.round(failureCount * 16 + (progress.state === 'ready_for_review' ? 18 : progress.state === 'evidence_present' ? 12 : 7) + trend.boost),
      5,
      100,
    );
    const effortBase = action.actionType === 'drill' ? 18 : action.actionType === 'concept' ? 32 : 48;
    const effortScore = clamp(effortBase + missingPrerequisiteSkillIds.length * 12, 5, 100);
    const score = clamp(Math.round(relevanceScore * 0.5 + impactScore * 0.45 - effortScore * 0.2), 1, 100);

    const recommendationId = recommendationKey(skill.skillId, action.actionType, action.actionTitle);
    const existing = existingById.get(recommendationId);

    const sourceEvidence = [
      ...matchedFailures.slice(0, 3).map((match) => ({
        entryId: match.entryId,
        createdAt: match.createdAt,
        excerpt: match.excerpt,
        signalType: 'failure-pattern' as const,
      })),
      ...relevantEvidence.map((item) => ({
        entryId: item.entryId,
        createdAt: item.createdAt,
        evidenceId: item.evidenceId,
        excerpt: item.statement,
        signalType: 'checkoff-evidence' as const,
      })),
      ...(missingPrerequisiteSkillIds.length > 0
        ? [
            {
              entryId: input.entries[0]?.entryId ?? 'curriculum',
              excerpt: `Missing prerequisites: ${missingPrerequisiteSkillIds.join(', ')}`,
              signalType: 'curriculum-dependency' as const,
            },
          ]
        : []),
      ...trend.notes.map((note) => ({
        entryId: input.entries[0]?.entryId ?? 'trend',
        excerpt: note,
        signalType: 'progress-trend' as const,
      })),
    ].slice(0, 6);

    const rationaleParts = [
      failureCount > 0 ? `${failureCount} recurring failure signal${failureCount === 1 ? '' : 's'} on ${skill.name}` : undefined,
      missingPrerequisiteSkillIds.length > 0
        ? `blocked by ${missingPrerequisiteSkillIds.length} prerequisite skill${missingPrerequisiteSkillIds.length === 1 ? '' : 's'}`
        : undefined,
      trend.notes[0],
    ].filter((part): part is string => Boolean(part));

    const keptAction =
      existing?.status === 'active' && existing.createdByRole === 'coach'
        ? {
            actionType: existing.actionType,
            actionTitle: existing.actionTitle,
            actionDetail: existing.actionDetail,
          }
        : action;

    recommendations.push({
      athleteId: input.athleteId,
      recommendationId,
      skillId: skill.skillId,
      sourceSkillId: skill.skillId,
      ...keptAction,
      status: existing?.status ?? 'draft',
      relevanceScore,
      impactScore,
      effortScore,
      score,
      rationale: existing?.rationale ?? rationaleParts.join('; '),
      whyNow:
        failureCount > 0
          ? `Recent entries show this failure ${failureCount} time${failureCount === 1 ? '' : 's'} in the current training window.`
          : 'Curriculum dependency and progress state indicate this is a high-leverage next step.',
      expectedImpact:
        keptAction.actionType === 'drill'
          ? 'Low-effort reps should reduce repeat failures in the next sessions.'
          : keptAction.actionType === 'concept'
            ? 'Reinforcing this concept should improve consistency before escalating complexity.'
            : 'Advancing this skill should unlock adjacent curriculum nodes.',
      sourceEvidence,
      supportingNextSkillIds,
      missingPrerequisiteSkillIds,
      generatedAt: existing?.generatedAt ?? input.nowIso,
      updatedAt: input.nowIso,
      ...(existing?.approvedBy ? { approvedBy: existing.approvedBy } : {}),
      ...(existing?.approvedAt ? { approvedAt: existing.approvedAt } : {}),
      ...(existing?.coachNote ? { coachNote: existing.coachNote } : {}),
      ...(existing?.createdByRole ? { createdByRole: existing.createdByRole } : { createdByRole: 'system' }),
    });
  }

  const recommendationIds = new Set(recommendations.map((item) => item.recommendationId));
  for (const existing of input.existingRecommendations ?? []) {
    if (existing.status === 'active' && !recommendationIds.has(existing.recommendationId)) {
      recommendations.push({
        ...existing,
        updatedAt: input.nowIso,
      });
    }
  }

  return recommendations
    .sort((a, b) => (a.status === b.status ? b.score - a.score : a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0))
    .slice(0, 12);
};

export const buildProgressAndRecommendations = (
  input: BuildProgressInput,
): { progressions: SkillProgress[]; recommendations: CurriculumRecommendation[] } => {
  assertNoInvalidCycles(input.skills, input.relationships);

  const skillById = new Map(input.skills.map((skill) => [skill.skillId, skill] as const));
  const existingBySkill = new Map((input.existingProgress ?? []).map((progress) => [progress.skillId, progress] as const));

  const evidenceBySkill = new Map<string, CheckoffEvidence[]>();
  for (const item of input.evidence) {
    const list = evidenceBySkill.get(item.skillId) ?? [];
    list.push(item);
    evidenceBySkill.set(item.skillId, list);
  }

  const checkoffsBySkill = new Map<string, Checkoff[]>();
  for (const item of input.checkoffs) {
    const list = checkoffsBySkill.get(item.skillId) ?? [];
    list.push(item);
    checkoffsBySkill.set(item.skillId, list);
  }

  const lastEntryHintsBySkill = new Map<string, string[]>();
  for (const entry of input.entries) {
    const actionPack = entry.actionPackFinal?.actionPack ?? entry.actionPackDraft;
    if (!actionPack) continue;
    const mentions = [...actionPack.leaks, ...actionPack.wins, actionPack.oneFocus]
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 4);

    for (const skill of input.skills) {
      const key = skill.name.toLowerCase();
      if (mentions.some((item) => item.toLowerCase().includes(key))) {
        lastEntryHintsBySkill.set(skill.skillId, mentions);
      }
    }
  }

  const prereqBySkill = buildPrereqAdjacency(input.skills, input.relationships);
  const progressions: SkillProgress[] = [];

  for (const skill of input.skills) {
    const evidenceItems = evidenceBySkill.get(skill.skillId) ?? [];
    const checkoffItems = checkoffsBySkill.get(skill.skillId) ?? [];
    const pendingCount = checkoffItems.filter((item) => item.status === 'pending').length;
    const earnedCount = checkoffItems.filter((item) => item.status === 'earned' || item.status === 'revalidated').length;

    const prereqs = [...(prereqBySkill.get(skill.skillId) ?? new Set<string>())];
    const blockedByPrereq = prereqs.some((id) => {
      const prereqCheckoffs = checkoffsBySkill.get(id) ?? [];
      return prereqCheckoffs.every((item) => item.status !== 'earned' && item.status !== 'revalidated');
    });

    const derivedState = stateFromSignals(evidenceItems.length, pendingCount, earnedCount, blockedByPrereq);
    const existing = existingBySkill.get(skill.skillId);
    const state = existing?.manualOverrideState ?? derivedState;

    const rationale: string[] = [];
    if (blockedByPrereq) {
      rationale.push(`Blocked by prerequisites: ${prereqs.join(', ')}`);
    }
    if (evidenceItems.length > 0) {
      rationale.push(`Evidence items: ${evidenceItems.length}`);
      rationale.push(...evidenceItems.slice(0, 2).map((item) => item.statement));
    }
    if (pendingCount > 0) {
      rationale.push(`Pending checkoffs: ${pendingCount}`);
    }
    const entryHints = lastEntryHintsBySkill.get(skill.skillId) ?? [];
    rationale.push(...entryHints.slice(0, 2));
    if (existing?.manualOverrideReason) {
      rationale.push(`Manual override: ${existing.manualOverrideReason}`);
    }

    const unlockedTargets = input.relationships
      .filter((relation) => relation.fromSkillId === skill.skillId)
      .map((relation) => relation.toSkillId)
      .filter((targetSkillId) => skillById.has(targetSkillId));

    progressions.push({
      athleteId: input.athleteId,
      skillId: skill.skillId,
      state,
      evidenceCount: evidenceItems.length,
      confidence: confidenceFromEvidenceCount(evidenceItems.length),
      rationale: normalizeStringList(rationale),
      sourceEntryIds: normalizeStringList(evidenceItems.map((item) => item.entryId)),
      sourceEvidenceIds: normalizeStringList(evidenceItems.map((item) => item.evidenceId)),
      suggestedNextSkillIds: normalizeStringList(unlockedTargets),
      lastEvaluatedAt: input.nowIso,
      ...(existing?.manualOverrideState ? { manualOverrideState: existing.manualOverrideState } : {}),
      ...(existing?.manualOverrideReason ? { manualOverrideReason: existing.manualOverrideReason } : {}),
      ...(existing?.coachReviewedBy ? { coachReviewedBy: existing.coachReviewedBy } : {}),
      ...(existing?.coachReviewedAt ? { coachReviewedAt: existing.coachReviewedAt } : {}),
    });
  }

  const recommendations = buildCurriculumRecommendations({
    athleteId: input.athleteId,
    nowIso: input.nowIso,
    skills: input.skills,
    relationships: input.relationships,
    progressions,
    evidence: input.evidence,
    entries: input.entries,
    progressViews: input.progressViews,
    existingRecommendations: input.existingRecommendations,
  });

  return { progressions, recommendations };
};

export const parseSkillProgressOverride = (raw: unknown): Pick<SkillProgress, 'manualOverrideState' | 'manualOverrideReason'> => {
  const payload = asRecord(raw);
  if (!payload) {
    invalid('Request body must be a JSON object.');
  }
  const body = payload as Record<string, unknown>;

  const state = body.manualOverrideState;
  if (
    state !== 'not_started' &&
    state !== 'working' &&
    state !== 'evidence_present' &&
    state !== 'ready_for_review' &&
    state !== 'complete' &&
    state !== 'blocked'
  ) {
    invalid('manualOverrideState must be a valid skill progress state.');
  }

  const reason = body.manualOverrideReason;
  if (typeof reason !== 'string' || !reason.trim()) {
    invalid('manualOverrideReason must be a non-empty string.');
  }
  const reasonText = (reason as string).trim();

  return {
    manualOverrideState: state as SkillProgressState,
    manualOverrideReason: reasonText,
  };
};
