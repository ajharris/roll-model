import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { defaultAutomationSettings, parseAutomationSettingsRecord } from '../../shared/automation';
import { getItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const existing = await getItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: 'AUTOMATION_SETTINGS'
      }
    });

    const nowIso = new Date().toISOString();
    const settings =
      existing.Item && parseAutomationSettingsRecord(existing.Item as Record<string, unknown>)
        ? parseAutomationSettingsRecord(existing.Item as Record<string, unknown>)
        : defaultAutomationSettings(auth.userId, nowIso, auth.userId);

    return response(200, { settings });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getAutomationSettings', baseHandler);

