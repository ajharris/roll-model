import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import {
  buildIntegrationSettingsRecord,
  defaultIntegrationSettings,
  mergeIntegrationSettings,
  parseIntegrationSettingsRecord
} from '../../shared/integrations';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { IntegrationSettings } from '../../shared/types';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseBody = (
  body: string | null
): {
  calendar?: Partial<IntegrationSettings['calendar']>;
  wearable?: Partial<IntegrationSettings['wearable']>;
} => {
  if (!body) {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'Request body is required.', statusCode: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'Request body must be valid JSON.', statusCode: 400 });
  }
  const payload = asRecord(parsed);
  if (!payload) {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'Request body must be an object.', statusCode: 400 });
  }
  const parseProvider = (name: 'calendar' | 'wearable') => {
    const raw = asRecord(payload[name]);
    if (payload[name] !== undefined && !raw) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `${name} must be an object when provided.`,
        statusCode: 400
      });
    }
    if (!raw) {
      return undefined;
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `${name}.enabled must be a boolean.`,
        statusCode: 400
      });
    }
    if (raw.connected !== undefined && typeof raw.connected !== 'boolean') {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `${name}.connected must be a boolean.`,
        statusCode: 400
      });
    }
    if (raw.selectedSourceId !== undefined && typeof raw.selectedSourceId !== 'string') {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `${name}.selectedSourceId must be a string.`,
        statusCode: 400
      });
    }
    if (raw.selectedSourceLabel !== undefined && typeof raw.selectedSourceLabel !== 'string') {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `${name}.selectedSourceLabel must be a string.`,
        statusCode: 400
      });
    }
    return {
      ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
      ...(typeof raw.connected === 'boolean' ? { connected: raw.connected } : {}),
      ...(typeof raw.selectedSourceId === 'string' ? { selectedSourceId: raw.selectedSourceId } : {}),
      ...(typeof raw.selectedSourceLabel === 'string' ? { selectedSourceLabel: raw.selectedSourceLabel } : {})
    };
  };

  const calendar = parseProvider('calendar');
  const wearable = parseProvider('wearable');
  return {
    ...(calendar ? { calendar } : {}),
    ...(wearable ? { wearable } : {})
  };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const patch = parseBody(event.body);
    const nowIso = new Date().toISOString();
    const existing = await getItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: 'INTEGRATION_SETTINGS'
      }
    });
    const current =
      existing.Item && parseIntegrationSettingsRecord(existing.Item as Record<string, unknown>)
        ? parseIntegrationSettingsRecord(existing.Item as Record<string, unknown>)
        : defaultIntegrationSettings(auth.userId, nowIso, auth.userId);
    const next = mergeIntegrationSettings(current!, patch, nowIso, auth.userId);
    await putItem({
      Item: buildIntegrationSettingsRecord(next)
    });

    return response(200, { settings: next });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertIntegrationSettings', baseHandler);
