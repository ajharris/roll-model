import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { AutomationSettingsUpdateRequest, WeeklyDigestUpdateRequest } from './types';

const invalid = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

const parseBody = (event: APIGatewayProxyEvent): Record<string, unknown> => {
  if (!event.body) {
    invalid('Request body is required.');
  }

  try {
    const raw = event.body;
    if (typeof raw !== 'string') {
      invalid('Request body must be valid JSON.');
    }
    const parsed = JSON.parse(raw as string) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalid('Request body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch {
    invalid('Request body must be valid JSON.');
  }

  return {};
};

export const parseAutomationSettingsUpdatePayload = (event: APIGatewayProxyEvent): AutomationSettingsUpdateRequest => {
  const body = parseBody(event);

  if (body.timezone !== undefined && typeof body.timezone !== 'string') {
    invalid('timezone must be a string.');
  }

  if (
    body.afterClassReminder !== undefined &&
    (typeof body.afterClassReminder !== 'object' || body.afterClassReminder === null || Array.isArray(body.afterClassReminder))
  ) {
    invalid('afterClassReminder must be an object.');
  }

  if (
    body.weeklyDigest !== undefined &&
    (typeof body.weeklyDigest !== 'object' || body.weeklyDigest === null || Array.isArray(body.weeklyDigest))
  ) {
    invalid('weeklyDigest must be an object.');
  }

  if (
    body.quietHours !== undefined &&
    (typeof body.quietHours !== 'object' || body.quietHours === null || Array.isArray(body.quietHours))
  ) {
    invalid('quietHours must be an object.');
  }

  return body as unknown as AutomationSettingsUpdateRequest;
};

export const parseReminderCapturePayload = (
  event: APIGatewayProxyEvent
): {
  notes: string;
  quickAdd?: {
    class?: string;
    gym?: string;
    rounds?: number;
    partners?: string[];
  };
  sessionMetrics?: {
    durationMinutes?: number;
    intensity?: number;
    rounds?: number;
    giOrNoGi?: string;
    tags?: string[];
  };
} => {
  const body = parseBody(event);

  const notes = body.notes;
  if (typeof notes !== 'string' || notes.trim().length === 0) {
    invalid('notes is required.');
  }

  if (body.quickAdd !== undefined && (typeof body.quickAdd !== 'object' || body.quickAdd === null || Array.isArray(body.quickAdd))) {
    invalid('quickAdd must be an object when provided.');
  }

  if (
    body.sessionMetrics !== undefined &&
    (typeof body.sessionMetrics !== 'object' || body.sessionMetrics === null || Array.isArray(body.sessionMetrics))
  ) {
    invalid('sessionMetrics must be an object when provided.');
  }

  const notesText = notes as string;
  return {
    notes: notesText.trim(),
    ...(body.quickAdd ? { quickAdd: body.quickAdd as Record<string, unknown> } : {}),
    ...(body.sessionMetrics ? { sessionMetrics: body.sessionMetrics as Record<string, unknown> } : {})
  } as unknown as {
    notes: string;
    quickAdd?: {
      class?: string;
      gym?: string;
      rounds?: number;
      partners?: string[];
    };
    sessionMetrics?: {
      durationMinutes?: number;
      intensity?: number;
      rounds?: number;
      giOrNoGi?: string;
      tags?: string[];
    };
  };
};

export const parseWeeklyDigestUpdatePayload = (event: APIGatewayProxyEvent): WeeklyDigestUpdateRequest => {
  const body = parseBody(event);

  if (
    body.selectedRecommendationIds !== undefined &&
    (!Array.isArray(body.selectedRecommendationIds) || body.selectedRecommendationIds.some((item) => typeof item !== 'string'))
  ) {
    invalid('selectedRecommendationIds must be an array of strings.');
  }

  if (body.recommendationEdits !== undefined) {
    if (!Array.isArray(body.recommendationEdits)) {
      invalid('recommendationEdits must be an array.');
    }
    for (const edit of body.recommendationEdits as unknown[]) {
      if (
        typeof edit !== 'object' ||
        edit === null ||
        Array.isArray(edit) ||
        typeof (edit as Record<string, unknown>).recommendationId !== 'string' ||
        typeof (edit as Record<string, unknown>).text !== 'string'
      ) {
        invalid('Each recommendation edit must include recommendationId and text.');
      }
    }
  }

  if (body.coachReviewNote !== undefined && typeof body.coachReviewNote !== 'string') {
    invalid('coachReviewNote must be a string.');
  }

  return body as unknown as WeeklyDigestUpdateRequest;
};
