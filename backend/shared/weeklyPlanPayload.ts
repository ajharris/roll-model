import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { WeeklyPlanItemStatus, WeeklyPlanStatus } from './types';

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
  if (event.body === null || event.body === undefined) {
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

const optionalString = (value: unknown, message: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(message);
  const trimmed = (value as string).trim();
  return trimmed || undefined;
};

const optionalStatus = (value: unknown): WeeklyPlanStatus | undefined => {
  if (value === undefined) return undefined;
  if (value === 'draft' || value === 'active' || value === 'completed') {
    return value;
  }
  invalid('weekly plan status must be draft, active, or completed.');
  return undefined;
};

const optionalItemStatus = (value: unknown, message: string): WeeklyPlanItemStatus | undefined => {
  if (value === undefined) return undefined;
  if (value === 'pending' || value === 'done' || value === 'skipped') {
    return value;
  }
  invalid(message);
  return undefined;
};

const parseMenuEdits = (
  value: unknown,
  field: 'drills' | 'positionalRounds' | 'constraints'
):
  | Array<{
      id: string;
      status?: WeeklyPlanItemStatus;
      coachNote?: string;
    }>
  | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    invalid(`${field} must be an array.`);
  }
  const values = value as unknown[];

  return values.map((raw, index) => {
    const item = asRecord(raw);
    if (!item) {
      invalid(`${field}[${index}] must be an object.`);
    }
    const parsedItem = item as Record<string, unknown>;

    const rawId = parsedItem.id;
    if (typeof rawId !== 'string' || !rawId.trim()) {
      invalid(`${field}[${index}].id must be a non-empty string.`);
    }

    const status = optionalItemStatus(
      parsedItem.status,
      `${field}[${index}].status must be pending, done, or skipped.`
    );
    const coachNote = optionalString(parsedItem.coachNote, `${field}[${index}].coachNote must be a string.`);

    return {
      id: (rawId as string).trim(),
      ...(status ? { status } : {}),
      ...(coachNote ? { coachNote } : {})
    };
  });
};

export type BuildWeeklyPlanRequest = {
  weekOf?: string;
};

export const parseBuildWeeklyPlanPayload = (event: APIGatewayProxyEvent): BuildWeeklyPlanRequest => {
  const payload = parseBody(event);
  const weekOf = optionalString(payload.weekOf, 'weekOf must be a string.');
  return {
    ...(weekOf ? { weekOf } : {})
  };
};

export type UpdateWeeklyPlanRequest = {
  status?: WeeklyPlanStatus;
  coachReviewNote?: string;
  completionNotes?: string;
  primarySkills?: string[];
  supportingConcept?: string;
  conditioningConstraint?: string;
  drills?: Array<{ id: string; status?: WeeklyPlanItemStatus; coachNote?: string }>;
  positionalRounds?: Array<{ id: string; status?: WeeklyPlanItemStatus; coachNote?: string }>;
  constraints?: Array<{ id: string; status?: WeeklyPlanItemStatus; coachNote?: string }>;
  lockPositionalFocus?: boolean;
  positionalFocusCards?: Array<{
    id: string;
    title?: string;
    position?: string;
    context?: string;
    rationale?: string;
    successCriteria?: string[];
    priority?: number;
    status?: WeeklyPlanItemStatus;
    coachNote?: string;
  }>;
};

const parseStringArray = (value: unknown, message: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    invalid(message);
  }
  const values = value as unknown[];

  const parsed = values.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      invalid(message);
    }
    return (item as string).trim();
  });

  return parsed;
};

const optionalBoolean = (value: unknown, message: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(message);
  return value as boolean;
};

const optionalPositiveInteger = (value: unknown, message: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    invalid(message);
  }
  return value as number;
};

const parsePositionalFocusCardEdits = (
  value: unknown
):
  | Array<{
      id: string;
      title?: string;
      position?: string;
      context?: string;
      rationale?: string;
      successCriteria?: string[];
      priority?: number;
      status?: WeeklyPlanItemStatus;
      coachNote?: string;
    }>
  | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    invalid('positionalFocusCards must be an array.');
  }
  const values = value as unknown[];
  return values.map((raw, index) => {
    const item = asRecord(raw);
    if (!item) {
      invalid(`positionalFocusCards[${index}] must be an object.`);
    }
    const parsed = item as Record<string, unknown>;
    const rawId = parsed.id;
    if (typeof rawId !== 'string' || !rawId.trim()) {
      invalid(`positionalFocusCards[${index}].id must be a non-empty string.`);
    }
    const id = String(rawId).trim();
    const title = optionalString(parsed.title, `positionalFocusCards[${index}].title must be a string.`);
    const position = optionalString(parsed.position, `positionalFocusCards[${index}].position must be a string.`);
    const context = optionalString(parsed.context, `positionalFocusCards[${index}].context must be a string.`);
    const rationale = optionalString(parsed.rationale, `positionalFocusCards[${index}].rationale must be a string.`);
    const successCriteria = parseStringArray(
      parsed.successCriteria,
      `positionalFocusCards[${index}].successCriteria must be an array of non-empty strings.`
    );
    const priority = optionalPositiveInteger(
      parsed.priority,
      `positionalFocusCards[${index}].priority must be a positive integer.`
    );
    const status = optionalItemStatus(
      parsed.status,
      `positionalFocusCards[${index}].status must be pending, done, or skipped.`
    );
    const coachNote = optionalString(parsed.coachNote, `positionalFocusCards[${index}].coachNote must be a string.`);

    return {
      id,
      ...(title ? { title } : {}),
      ...(position ? { position } : {}),
      ...(context ? { context } : {}),
      ...(rationale ? { rationale } : {}),
      ...(successCriteria ? { successCriteria } : {}),
      ...(priority ? { priority } : {}),
      ...(status ? { status } : {}),
      ...(coachNote ? { coachNote } : {})
    };
  });
};

export const parseUpdateWeeklyPlanPayload = (event: APIGatewayProxyEvent): UpdateWeeklyPlanRequest => {
  const payload = parseBody(event);

  const status = optionalStatus(payload.status);
  const coachReviewNote = optionalString(payload.coachReviewNote, 'coachReviewNote must be a string.');
  const completionNotes = optionalString(payload.completionNotes, 'completionNotes must be a string.');
  const primarySkills = parseStringArray(payload.primarySkills, 'primarySkills must be an array of non-empty strings.');
  const supportingConcept = optionalString(payload.supportingConcept, 'supportingConcept must be a string.');
  const conditioningConstraint = optionalString(
    payload.conditioningConstraint,
    'conditioningConstraint must be a string.'
  );
  const drills = parseMenuEdits(payload.drills, 'drills');
  const positionalRounds = parseMenuEdits(payload.positionalRounds, 'positionalRounds');
  const constraints = parseMenuEdits(payload.constraints, 'constraints');
  const lockPositionalFocus = optionalBoolean(
    payload.lockPositionalFocus,
    'lockPositionalFocus must be a boolean.'
  );
  const positionalFocusCards = parsePositionalFocusCardEdits(payload.positionalFocusCards);

  return {
    ...(status ? { status } : {}),
    ...(coachReviewNote ? { coachReviewNote } : {}),
    ...(completionNotes ? { completionNotes } : {}),
    ...(primarySkills ? { primarySkills } : {}),
    ...(supportingConcept ? { supportingConcept } : {}),
    ...(conditioningConstraint ? { conditioningConstraint } : {}),
    ...(drills ? { drills } : {}),
    ...(positionalRounds ? { positionalRounds } : {}),
    ...(constraints ? { constraints } : {}),
    ...(lockPositionalFocus !== undefined ? { lockPositionalFocus } : {}),
    ...(positionalFocusCards ? { positionalFocusCards } : {})
  };
};
