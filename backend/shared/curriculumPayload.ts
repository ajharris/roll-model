import type { APIGatewayProxyEvent } from 'aws-lambda';

import { normalizeId } from './curriculum';
import { ApiError } from './responses';
import type { CurriculumStage, Skill, SkillRelationship } from './types';

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseBody = (event: APIGatewayProxyEvent): Record<string, unknown> => {
  if (!event.body) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    invalid('Request body must be valid JSON.');
  }

  const payload = asRecord(parsed);
  if (!payload) {
    invalid('Request body must be a JSON object.');
  }

  return payload as Record<string, unknown>;
};

const parseNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    invalid(`${field} must be a non-empty string.`);
  }
  const trimmed = (value as string).trim();
  if (!trimmed) {
    invalid(`${field} must be a non-empty string.`);
  }
  return trimmed;
};

const parseStringArray = (value: unknown, field: string): string[] => {
  const values = Array.isArray(value) ? value : invalid(`${field} must be an array.`);
  return values.map((item: unknown, index: number) => parseNonEmptyString(item, `${field}[${index}]`));
};

const parseOptionalStringArray = (value: unknown, field: string): string[] => {
  if (value === undefined) return [];
  return parseStringArray(value, field);
};

export const parseCurriculumStagesPayload = (event: APIGatewayProxyEvent): { stages: CurriculumStage[] } => {
  const payload = parseBody(event);
  const rawStages = payload.stages;
  const stageValues = Array.isArray(rawStages) ? rawStages : invalid('stages must be an array.');

  const stages = stageValues.map((rawStage: unknown, index: number) => {
    const stageRecord = asRecord(rawStage);
    if (!stageRecord) {
      invalid(`stages[${index}] must be an object.`);
    }

    const stage = stageRecord as Record<string, unknown>;
    const order = stage.order;
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 1 || order > 99) {
      invalid(`stages[${index}].order must be an integer between 1 and 99.`);
    }
    const parsedOrder = order as number;

    return {
      stageId: normalizeId(parseNonEmptyString(stage.stageId, `stages[${index}].stageId`), 'stageId'),
      name: parseNonEmptyString(stage.name, `stages[${index}].name`),
      order: parsedOrder,
      milestoneSkills: parseOptionalStringArray(stage.milestoneSkills, `stages[${index}].milestoneSkills`).map((item) =>
        normalizeId(item, 'milestoneSkills[]')
      ),
      notes: typeof stage.notes === 'string' ? stage.notes.trim() : undefined,
      updatedAt: ''
    } as CurriculumStage;
  });

  return { stages: stages as CurriculumStage[] };
};

export const parseUpsertSkillPayload = (event: APIGatewayProxyEvent, skillIdFromPath?: string): Skill => {
  const payload = parseBody(event);

  const category = payload.category;
  if (
    category !== 'escape' &&
    category !== 'pass' &&
    category !== 'guard-retention' &&
    category !== 'sweep' &&
    category !== 'submission' &&
    category !== 'takedown' &&
    category !== 'control' &&
    category !== 'transition' &&
    category !== 'concept' &&
    category !== 'other'
  ) {
    invalid('category is invalid.');
  }
  const parsedCategory = category as Skill['category'];

  const parsedSkillId = normalizeId(
    skillIdFromPath ?? parseNonEmptyString(payload.skillId, 'skillId'),
    skillIdFromPath ? 'path skillId' : 'skillId'
  );

  return {
    skillId: parsedSkillId,
    name: parseNonEmptyString(payload.name, 'name'),
    category: parsedCategory,
    stageId: normalizeId(parseNonEmptyString(payload.stageId, 'stageId'), 'stageId'),
    prerequisites: parseOptionalStringArray(payload.prerequisites, 'prerequisites').map((item) =>
      normalizeId(item, 'prerequisites[]')
    ),
    keyConcepts: parseOptionalStringArray(payload.keyConcepts, 'keyConcepts'),
    commonFailures: parseOptionalStringArray(payload.commonFailures, 'commonFailures'),
    drills: parseOptionalStringArray(payload.drills, 'drills'),
    createdAt: '',
    updatedAt: ''
  };
};

export const parseUpsertRelationshipPayload = (event: APIGatewayProxyEvent): SkillRelationship => {
  const payload = parseBody(event);

  const relation = payload.relation;
  if (relation !== 'prerequisite' && relation !== 'supports' && relation !== 'counter' && relation !== 'transition') {
    invalid('relation must be prerequisite, supports, counter, or transition.');
  }
  const parsedRelation = relation as SkillRelationship['relation'];

  return {
    fromSkillId: normalizeId(parseNonEmptyString(payload.fromSkillId, 'fromSkillId'), 'fromSkillId'),
    toSkillId: normalizeId(parseNonEmptyString(payload.toSkillId, 'toSkillId'), 'toSkillId'),
    relation: parsedRelation,
    rationale: typeof payload.rationale === 'string' ? payload.rationale.trim() : undefined,
    createdAt: '',
    updatedAt: ''
  };
};
