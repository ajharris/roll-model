import { ApiError } from './responses';
import type { Entry, Checkoff, CheckoffEvidence, Skill, SkillProgress, SkillRelationship, CurriculumStage, CurriculumRecommendation, SkillCategory, SkillProgressState, ConfidenceLevel } from './types';

export const CURRICULUM_STAGE_PREFIX = 'CURRICULUM_STAGE#';
export const CURRICULUM_SKILL_PREFIX = 'CURRICULUM_SKILL#';
export const CURRICULUM_REL_PREFIX = 'CURRICULUM_REL#FROM#';
export const CURRICULUM_PROGRESS_PREFIX = 'CURRICULUM_PROGRESS#';

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
  'other'
];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
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
    drills: normalizeStringList(skill.drills)
  };
};

export const stageSk = (stageId: string, order: number): string =>
  `${CURRICULUM_STAGE_PREFIX}${String(order).padStart(2, '0')}#${normalizeId(stageId, 'stageId')}`;

export const skillSk = (skillId: string): string => `${CURRICULUM_SKILL_PREFIX}${normalizeId(skillId, 'skillId')}`;

export const relationshipSk = (fromSkillId: string, toSkillId: string): string =>
  `${CURRICULUM_REL_PREFIX}${normalizeId(fromSkillId, 'fromSkillId')}#TO#${normalizeId(toSkillId, 'toSkillId')}`;

export const progressSk = (skillId: string): string => `${CURRICULUM_PROGRESS_PREFIX}${normalizeId(skillId, 'skillId')}`;

export const buildStageRecord = (athleteId: string, stage: CurriculumStage): Record<string, unknown> => ({
  PK: `USER#${athleteId}`,
  SK: stageSk(stage.stageId, stage.order),
  entityType: 'CURRICULUM_STAGE',
  GSI1PK: `CURRICULUM_STAGE#${normalizeId(stage.stageId, 'stageId')}`,
  GSI1SK: `ORDER#${String(stage.order).padStart(2, '0')}`,
  ...stage
});

export const buildSkillRecord = (athleteId: string, skill: Skill): Record<string, unknown> => ({
  PK: `USER#${athleteId}`,
  SK: skillSk(skill.skillId),
  entityType: 'CURRICULUM_SKILL',
  GSI1PK: `CURRICULUM_STAGE#${normalizeId(skill.stageId, 'stageId')}`,
  GSI1SK: `SKILL#${skill.name.toLowerCase()}#${normalizeId(skill.skillId, 'skillId')}`,
  ...skill
});

export const buildRelationshipRecord = (athleteId: string, relationship: SkillRelationship): Record<string, unknown> => ({
  PK: `USER#${athleteId}`,
  SK: relationshipSk(relationship.fromSkillId, relationship.toSkillId),
  entityType: 'CURRICULUM_RELATIONSHIP',
  GSI1PK: `CURRICULUM_DEPENDS_ON#${normalizeId(relationship.toSkillId, 'toSkillId')}`,
  GSI1SK: `SKILL#${normalizeId(relationship.fromSkillId, 'fromSkillId')}`,
  ...relationship
});

export const buildProgressRecord = (progress: SkillProgress): Record<string, unknown> => ({
  PK: `USER#${progress.athleteId}`,
  SK: progressSk(progress.skillId),
  entityType: 'CURRICULUM_PROGRESS',
  ...progress
});

export type CurriculumSnapshot = {
  stages: CurriculumStage[];
  skills: Skill[];
  relationships: SkillRelationship[];
  progressions: SkillProgress[];
};

export const parseCurriculumSnapshot = (items: Array<Record<string, unknown>>): CurriculumSnapshot => {
  const stages: CurriculumStage[] = [];
  const skills: Skill[] = [];
  const relationships: SkillRelationship[] = [];
  const progressions: SkillProgress[] = [];

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
  }

  stages.sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name) : a.order - b.order));
  skills.sort((a, b) => a.name.localeCompare(b.name));

  return { stages, skills, relationships, progressions };
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
  blockedByPrereq: boolean
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
  existingProgress?: SkillProgress[];
  nowIso: string;
};

export const buildProgressAndRecommendations = (
  input: BuildProgressInput
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
      ...(existing?.coachReviewedAt ? { coachReviewedAt: existing.coachReviewedAt } : {})
    });
  }

  const progressBySkill = new Map(progressions.map((item) => [item.skillId, item] as const));

  const recommendations = input.skills
    .map((skill) => {
      const progress = progressBySkill.get(skill.skillId);
      if (!progress || progress.state === 'complete' || progress.state === 'blocked') {
        return null;
      }

      const prereqs = [...(prereqBySkill.get(skill.skillId) ?? new Set<string>())];
      const missingPrerequisiteSkillIds = prereqs.filter(
        (prereqSkillId) => progressBySkill.get(prereqSkillId)?.state !== 'complete'
      );
      const score =
        (progress.state === 'ready_for_review' ? 120 : progress.state === 'evidence_present' ? 90 : 60) +
        Math.max(0, 20 - missingPrerequisiteSkillIds.length * 10) +
        Math.min(20, progress.evidenceCount * 4);

      return {
        skillId: skill.skillId,
        score,
        rationale: progress.rationale.slice(0, 4),
        missingPrerequisiteSkillIds
      } satisfies CurriculumRecommendation;
    })
    .filter((item): item is CurriculumRecommendation => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

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
    manualOverrideReason: reasonText
  };
};
