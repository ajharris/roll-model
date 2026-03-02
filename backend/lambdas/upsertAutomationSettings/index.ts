import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import {
  buildAutomationSettingsRecord,
  defaultAutomationSettings,
  mergeAutomationSettings,
  parseAutomationSettingsRecord
} from '../../shared/automation';
import { parseAutomationSettingsUpdatePayload } from '../../shared/automationPayload';
import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseAutomationSettingsUpdatePayload(event);
    const nowIso = new Date().toISOString();

    const existing = await getItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: 'AUTOMATION_SETTINGS'
      }
    });

    const current =
      existing.Item && parseAutomationSettingsRecord(existing.Item as Record<string, unknown>)
        ? parseAutomationSettingsRecord(existing.Item as Record<string, unknown>)
        : defaultAutomationSettings(auth.userId, nowIso, auth.userId);

    const next = mergeAutomationSettings(current!, payload, nowIso, auth.userId);

    await putItem({
      Item: buildAutomationSettingsRecord(next)
    });

    return response(200, { settings: next });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertAutomationSettings', baseHandler);

