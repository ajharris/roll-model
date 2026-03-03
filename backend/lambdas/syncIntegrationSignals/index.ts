import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import {
  buildIntegrationSignalRecord,
  defaultIntegrationSettings,
  normalizeIntegrationSignalImport,
  parseIntegrationSettingsRecord,
  summarizeSyncResult
} from '../../shared/integrations';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { IntegrationProvider, IntegrationSignalImport, IntegrationSyncFailure } from '../../shared/types';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseBody = (body: string | null): { signals: IntegrationSignalImport[] } => {
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
  if (!payload || !Array.isArray(payload.signals)) {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'signals[] is required.', statusCode: 400 });
  }

  return {
    signals: payload.signals as IntegrationSignalImport[]
  };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseBody(event.body);
    const nowIso = new Date().toISOString();
    const settingsResult = await getItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: 'INTEGRATION_SETTINGS'
      }
    });
    const settings =
      settingsResult.Item && parseIntegrationSettingsRecord(settingsResult.Item as Record<string, unknown>)
        ? parseIntegrationSettingsRecord(settingsResult.Item as Record<string, unknown>)
        : defaultIntegrationSettings(auth.userId, nowIso, auth.userId);

    let imported = 0;
    let duplicates = 0;
    const failures: IntegrationSyncFailure[] = [];

    for (let index = 0; index < payload.signals.length; index += 1) {
      const raw = payload.signals[index];
      const normalized = normalizeIntegrationSignalImport(auth.userId, raw, nowIso);
      if (!normalized.record) {
        failures.push({
          index,
          provider: raw.provider as IntegrationProvider,
          externalId: typeof raw.externalId === 'string' ? raw.externalId : undefined,
          reason: normalized.failure?.reason ?? 'Invalid signal.',
          recoverable: normalized.failure?.recoverable ?? true
        });
        continue;
      }

      const providerSettings = normalized.record.provider === 'calendar' ? settings!.calendar : settings!.wearable;
      if (!providerSettings.connected || !providerSettings.enabled) {
        failures.push({
          index,
          provider: normalized.record.provider,
          externalId: normalized.record.externalId,
          reason: `${normalized.record.provider} integration is disconnected or disabled.`,
          recoverable: true
        });
        continue;
      }

      const existing = await getItem({
        Key: {
          PK: `USER#${auth.userId}`,
          SK: `INTEGRATION_SIGNAL#${normalized.record.provider}#${normalized.record.externalId}`
        }
      });

      if (existing.Item && existing.Item.entityType === 'INTEGRATION_SIGNAL') {
        duplicates += 1;
        continue;
      }

      try {
        await putItem({
          Item: buildIntegrationSignalRecord(normalized.record)
        });
        imported += 1;
      } catch {
        failures.push({
          index,
          provider: normalized.record.provider,
          externalId: normalized.record.externalId,
          reason: 'Failed to persist signal.',
          recoverable: true
        });
      }
    }

    return response(200, {
      result: summarizeSyncResult(imported, duplicates, failures)
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('syncIntegrationSignals', baseHandler);
