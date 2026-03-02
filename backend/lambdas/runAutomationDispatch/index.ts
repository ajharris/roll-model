import type { EventBridgeHandler } from 'aws-lambda';

import {
  afterClassNotificationSk,
  buildAfterClassNotification,
  buildNotificationRecord,
  buildWeeklyDigestMetaRecord,
  buildWeeklyDigestNotification,
  buildWeeklyDigestRecord,
  buildWeeklyDigestWithGpt,
  evaluateAutomationDue,
  parseAutomationSettingsRecord,
  weeklyDigestNotificationSk
} from '../../shared/automation';
import { getItem, putItem, queryItems } from '../../shared/db';
import { parseEntryRecord } from '../../shared/entries';
import type { Checkoff, Entry, WeeklyPlan } from '../../shared/types';
import { parseWeeklyPlanRecord } from '../../shared/weeklyPlans';

const loadAllSettings = async (): Promise<Array<ReturnType<typeof parseAutomationSettingsRecord>>> => {
  const out: Array<ReturnType<typeof parseAutomationSettingsRecord>> = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': 'AUTOMATION_SETTINGS',
        ':prefix': 'USER#'
      },
      ExclusiveStartKey: exclusiveStartKey
    });

    for (const item of result.Items ?? []) {
      const parsed = parseAutomationSettingsRecord(item as Record<string, unknown>);
      if (parsed) {
        out.push(parsed);
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return out;
};

const loadDigestSignals = async (athleteId: string): Promise<{ entries: Entry[]; checkoffs: Checkoff[]; weeklyPlans: WeeklyPlan[] }> => {
  const [entriesResult, checkoffsResult, plansResult] = await Promise.all([
    queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'ENTRY#'
      },
      ScanIndexForward: false,
      Limit: 24
    }),
    queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'CHECKOFF#SKILL#'
      },
      ScanIndexForward: false,
      Limit: 30
    }),
    queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'WEEKLY_PLAN#'
      },
      ScanIndexForward: false,
      Limit: 6
    })
  ]);

  return {
    entries: (entriesResult.Items ?? [])
      .filter((item) => item.entityType === 'ENTRY')
      .map((item) => parseEntryRecord(item as Record<string, unknown>)),
    checkoffs: (checkoffsResult.Items ?? []).filter((item) => item.entityType === 'CHECKOFF') as Checkoff[],
    weeklyPlans: (plansResult.Items ?? [])
      .filter((item) => item.entityType === 'WEEKLY_PLAN')
      .map((item) => parseWeeklyPlanRecord(item as Record<string, unknown>))
  };
};

export const handler: EventBridgeHandler<'Scheduled Event', unknown, { processed: number; remindersCreated: number; digestsCreated: number }> =
  async () => {
    const nowIso = new Date().toISOString();
    const settingsList = await loadAllSettings();

    let remindersCreated = 0;
    let digestsCreated = 0;

    for (const settings of settingsList) {
      if (!settings) {
        continue;
      }

      const due = evaluateAutomationDue(settings, nowIso);

      if (due.afterClassDue) {
        const reminderSk = afterClassNotificationSk(due.reminderDispatchKey);
        const existingReminder = await getItem({
          Key: {
            PK: `USER#${settings.athleteId}`,
            SK: reminderSk
          }
        });

        if (!existingReminder.Item) {
          const reminder = buildAfterClassNotification(settings.athleteId, settings, nowIso, due.reminderDispatchKey);
          await putItem({
            Item: buildNotificationRecord(settings.athleteId, reminderSk, reminder)
          });
          remindersCreated += 1;
        }
      }

      if (due.weeklyDigestDue) {
        const existingDigestRows = await queryItems({
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `USER#${settings.athleteId}`,
            ':prefix': `WEEKLY_DIGEST#${due.digestWeekOf}#`
          },
          Limit: 1,
          ScanIndexForward: false
        });

        if ((existingDigestRows.Items ?? []).length === 0) {
          const signals = await loadDigestSignals(settings.athleteId);
          const digest = await buildWeeklyDigestWithGpt({
            athleteId: settings.athleteId,
            weekOf: due.digestWeekOf,
            timezone: settings.timezone,
            nowIso,
            entries: signals.entries,
            checkoffs: signals.checkoffs,
            weeklyPlans: signals.weeklyPlans
          });

          await putItem({
            Item: buildWeeklyDigestRecord(digest)
          });
          await putItem({
            Item: buildWeeklyDigestMetaRecord(digest)
          });

          const digestNotification = buildWeeklyDigestNotification(
            settings.athleteId,
            settings,
            nowIso,
            due.digestWeekOf,
            digest.digestId
          );

          await putItem({
            Item: buildNotificationRecord(settings.athleteId, weeklyDigestNotificationSk(due.digestWeekOf), digestNotification)
          });

          digestsCreated += 1;
        }
      }
    }

    return {
      processed: settingsList.length,
      remindersCreated,
      digestsCreated
    };
  };
