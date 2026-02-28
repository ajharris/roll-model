import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { WeeklyPlan, WeeklyPlanItemStatus } from '../../shared/types';
import { parseUpdateWeeklyPlanPayload } from '../../shared/weeklyPlanPayload';
import {
  buildWeeklyPlanMetaRecord,
  buildWeeklyPlanRecord,
  parseWeeklyPlanRecord,
  weeklyPlanMetaPk,
  weeklyPlanPk,
  weeklyPlanSk
} from '../../shared/weeklyPlans';

const requirePlanId = (value?: string): string => {
  if (!value) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'planId is required.',
      statusCode: 400
    });
  }
  return value;
};

const applyMenuEdits = (
  existing: WeeklyPlan['drills'],
  edits: Array<{ id: string; status?: WeeklyPlanItemStatus; coachNote?: string }> | undefined,
  nowIso: string
): WeeklyPlan['drills'] => {
  if (!edits || edits.length === 0) {
    return existing;
  }

  const editMap = new Map(edits.map((item) => [item.id, item]));
  return existing.map((item) => {
    const edit = editMap.get(item.id);
    if (!edit) {
      return item;
    }

    const nextStatus = edit.status ?? item.status;
    return {
      ...item,
      status: nextStatus,
      ...(nextStatus === 'done' ? { completedAt: item.completedAt ?? nowIso } : {}),
      ...(edit.coachNote ? { coachNote: edit.coachNote } : {})
    };
  });
};

const normalizeFocusCardPriority = (
  cards: WeeklyPlan['positionalFocus']['cards']
): WeeklyPlan['positionalFocus']['cards'] =>
  [...cards]
    .sort((a, b) => a.priority - b.priority)
    .map((card, index) => ({
      ...card,
      priority: index + 1
    }));

const applyPositionalFocusEdits = (
  existing: WeeklyPlan['positionalFocus'],
  edits: NonNullable<ReturnType<typeof parseUpdateWeeklyPlanPayload>['positionalFocusCards']> | undefined,
  nowIso: string
): WeeklyPlan['positionalFocus'] => {
  if (!edits || edits.length === 0) {
    return existing;
  }

  const cards = [...existing.cards];
  const cardById = new Map(cards.map((item) => [item.id, item] as const));

  for (const edit of edits) {
    const existingCard = cardById.get(edit.id);
    if (!existingCard) {
      continue;
    }

    const editingPriorityOrContent =
      edit.priority !== undefined ||
      edit.title !== undefined ||
      edit.position !== undefined ||
      edit.context !== undefined ||
      edit.rationale !== undefined ||
      edit.successCriteria !== undefined;

    if (existing.locked && editingPriorityOrContent) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'Positional focus priorities are locked for this week.',
        statusCode: 400
      });
    }

    cardById.set(edit.id, {
      ...existingCard,
      ...(edit.title ? { title: edit.title } : {}),
      ...(edit.position ? { position: edit.position } : {}),
      ...(edit.context ? { context: edit.context } : {}),
      ...(edit.rationale ? { rationale: edit.rationale } : {}),
      ...(edit.successCriteria ? { successCriteria: edit.successCriteria } : {}),
      ...(edit.priority ? { priority: edit.priority } : {}),
      ...(edit.status ? { status: edit.status } : {}),
      ...(edit.coachNote ? { coachNote: edit.coachNote } : {})
    });
  }

  return {
    ...existing,
    cards: normalizeFocusCardPriority(cards.map((item) => cardById.get(item.id) ?? item)),
    updatedAt: nowIso
  };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const planId = requirePlanId(event.pathParameters?.planId);
    const targetAthleteId = event.pathParameters?.athleteId ?? auth.userId;
    const coachMode = targetAthleteId !== auth.userId;

    if (coachMode) {
      if (!hasRole(auth, 'coach')) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'User does not have permission for this action.',
          statusCode: 403
        });
      }

      const link = await getItem({
        Key: {
          PK: `USER#${targetAthleteId}`,
          SK: `COACH#${auth.userId}`
        }
      });

      if (!isCoachLinkActive(link.Item)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403
        });
      }
    }

    const meta = await getItem({
      Key: {
        PK: weeklyPlanMetaPk(planId),
        SK: 'META'
      }
    });

    if (
      !meta.Item ||
      meta.Item.entityType !== 'WEEKLY_PLAN_META' ||
      typeof meta.Item.athleteId !== 'string' ||
      typeof meta.Item.weekOf !== 'string'
    ) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Weekly plan not found.',
        statusCode: 404
      });
    }

    if (meta.Item.athleteId !== targetAthleteId) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'User does not have permission for this weekly plan.',
        statusCode: 403
      });
    }

    const row = await getItem({
      Key: {
        PK: weeklyPlanPk(targetAthleteId),
        SK: weeklyPlanSk(meta.Item.weekOf, planId)
      }
    });

    if (!row.Item || row.Item.entityType !== 'WEEKLY_PLAN') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Weekly plan not found.',
        statusCode: 404
      });
    }

    const existing = parseWeeklyPlanRecord(row.Item as Record<string, unknown>);
    const payload = parseUpdateWeeklyPlanPayload(event);
    const nowIso = new Date().toISOString();

    const next: WeeklyPlan = {
      ...existing,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.primarySkills ? { primarySkills: payload.primarySkills.slice(0, 2) } : {}),
      ...(payload.supportingConcept ? { supportingConcept: payload.supportingConcept } : {}),
      ...(payload.conditioningConstraint ? { conditioningConstraint: payload.conditioningConstraint } : {}),
      drills: applyMenuEdits(existing.drills, payload.drills, nowIso),
      positionalRounds: applyMenuEdits(existing.positionalRounds, payload.positionalRounds, nowIso),
      constraints: applyMenuEdits(existing.constraints, payload.constraints, nowIso),
      positionalFocus: applyPositionalFocusEdits(existing.positionalFocus, payload.positionalFocusCards, nowIso),
      ...(payload.completionNotes
        ? {
            completion: {
              ...(existing.completion ?? {}),
              outcomeNotes: payload.completionNotes
            }
          }
        : {}),
      ...(payload.status === 'completed'
        ? {
            completion: {
              ...(existing.completion ?? {}),
              ...(payload.completionNotes ? { outcomeNotes: payload.completionNotes } : {}),
              completedAt: existing.completion?.completedAt ?? nowIso
            }
          }
        : {}),
      ...(payload.coachReviewNote
        ? {
            coachReview: {
              reviewedBy: auth.userId,
              reviewedAt: nowIso,
              notes: payload.coachReviewNote
            }
          }
        : {}),
      updatedAt: nowIso
    };

    if (payload.lockPositionalFocus) {
      if (coachMode) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach cannot lock weekly positional focus.',
          statusCode: 403
        });
      }
      next.positionalFocus = {
        ...next.positionalFocus,
        locked: true,
        lockedAt: next.positionalFocus.lockedAt ?? nowIso,
        lockedBy: next.positionalFocus.lockedBy ?? auth.userId,
        updatedAt: nowIso
      };
    }

    await putItem({
      Item: buildWeeklyPlanRecord(next)
    });
    await putItem({
      Item: {
        ...buildWeeklyPlanMetaRecord(next),
        createdAt: typeof meta.Item.createdAt === 'string' ? meta.Item.createdAt : next.generatedAt,
      }
    });

    return response(200, { plan: next });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateWeeklyPlan', baseHandler);
