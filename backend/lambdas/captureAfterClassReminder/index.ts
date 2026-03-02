import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { parseNotificationRecord } from '../../shared/automation';
import { parseReminderCapturePayload } from '../../shared/automationPayload';
import { putItem, queryItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { callOpenAI } from '../../shared/openai';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { CreateEntryRequest } from '../../shared/types';
import { buildEntry } from '../createEntry/index';

const requireNotificationId = (value?: string): string => {
  if (!value) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'notificationId is required.',
      statusCode: 400
    });
  }
  return value;
};

const findNotification = async (athleteId: string, notificationId: string): Promise<Record<string, unknown>> => {
  const rows = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${athleteId}`,
      ':prefix': 'NOTIFICATION#AFTER_CLASS#'
    },
    ScanIndexForward: false,
    Limit: 30
  });

  const found = (rows.Items ?? []).find((item) => item.notificationId === notificationId);
  if (!found) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: 'After-class reminder not found.',
      statusCode: 404
    });
  }

  return found as Record<string, unknown>;
};

const buildPrompt = (notes: string): string =>
  [
    'You are Roll Model AI. Parse these class notes into post-class training structure.',
    'Return strict JSON with shape:',
    '{"text": string, "extracted_updates": {"summary": string, "actionPack": {"wins": string[], "leaks": string[], "oneFocus": string, "drills": string[], "positionalRequests": string[], "fallbackDecisionGuidance": string, "confidenceFlags": [{"field": "wins"|"leaks"|"oneFocus"|"drills"|"positionalRequests"|"fallbackDecisionGuidance", "confidence": "high"|"medium"|"low", "note"?: string}]}, "sessionReview"?: {"promptSet": {"whatWorked": string[], "whatFailed": string[], "whatToAskCoach": string[], "whatToDrillSolo": string[]}, "oneThing": string, "confidenceFlags": [{"field": "whatWorked"|"whatFailed"|"whatToAskCoach"|"whatToDrillSolo"|"oneThing", "confidence": "high"|"medium"|"low", "note"?: string}]}, "suggestedFollowUpQuestions": string[]}, "suggested_prompts": string[]}',
    `Class notes: ${notes}`
  ].join(' ');

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const notificationId = requireNotificationId(event.pathParameters?.notificationId);
    const payload = parseReminderCapturePayload(event);
    const notificationRow = await findNotification(auth.userId, notificationId);
    const notification = parseNotificationRecord(notificationRow);

    if (!notification || notification.kind !== 'after-class-reminder') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'After-class reminder not found.',
        statusCode: 404
      });
    }

    if (notification.status !== 'sent') {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'Reminder capture has already been used.',
        statusCode: 400
      });
    }

    const ai = await callOpenAI([
      {
        role: 'system',
        content: 'You are Roll Model AI, a scientific, coach-like, practical grappling training assistant.'
      },
      {
        role: 'user',
        content: buildPrompt(payload.notes)
      }
    ]);

    const nowIso = new Date().toISOString();

    const entryPayload: CreateEntryRequest = {
      quickAdd: {
        time: nowIso,
        class: payload.quickAdd?.class ?? 'Class Session',
        gym: payload.quickAdd?.gym ?? '',
        partners: payload.quickAdd?.partners ?? [],
        rounds: typeof payload.quickAdd?.rounds === 'number' ? payload.quickAdd.rounds : 0,
        notes: payload.notes
      },
      tags: [],
      sections: {
        private: '',
        shared: payload.notes
      },
      sessionMetrics: {
        durationMinutes: typeof payload.sessionMetrics?.durationMinutes === 'number' ? payload.sessionMetrics.durationMinutes : 60,
        intensity: typeof payload.sessionMetrics?.intensity === 'number' ? payload.sessionMetrics.intensity : 6,
        rounds:
          typeof payload.sessionMetrics?.rounds === 'number'
            ? payload.sessionMetrics.rounds
            : typeof payload.quickAdd?.rounds === 'number'
              ? payload.quickAdd.rounds
              : 0,
        giOrNoGi: payload.sessionMetrics?.giOrNoGi ?? 'no-gi',
        tags: payload.sessionMetrics?.tags ?? []
      },
      actionPackDraft: ai.extracted_updates.actionPack,
      ...(ai.extracted_updates.sessionReview ? { sessionReviewDraft: ai.extracted_updates.sessionReview } : {})
    };

    const entry = buildEntry(auth.userId, entryPayload, nowIso, uuidv4());

    await putItem({
      Item: {
        PK: `USER#${auth.userId}`,
        SK: `ENTRY#${entry.createdAt}#${entry.entryId}`,
        entityType: 'ENTRY',
        ...entry
      }
    });

    await putItem({
      Item: {
        PK: `ENTRY#${entry.entryId}`,
        SK: 'META',
        entityType: 'ENTRY_META',
        athleteId: auth.userId,
        createdAt: entry.createdAt
      }
    });

    await recomputeAndPersistProgressViews(auth.userId);

    await putItem({
      Item: {
        ...notificationRow,
        status: 'acted',
        actedAt: nowIso,
        updatedAt: nowIso
      }
    });

    return response(201, {
      entry,
      extracted_updates: ai.extracted_updates,
      reminderStatus: 'acted'
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('captureAfterClassReminder', baseHandler);
