import { getItem, putItem, queryItems } from './db';
import type { MigrationRunAttempt, MigrationRunRecord, MigrationRunStatus, MigrationScope } from './types';

const migrationRunSk = (scope: MigrationScope, runId: string): string => `MIGRATION#${scope}#${runId}`;

const normalizeAttempts = (value: unknown): MigrationRunAttempt[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((attempt) => {
      if (typeof attempt !== 'object' || attempt === null) {
        return null;
      }
      const item = attempt as Record<string, unknown>;
      if (
        typeof item.attempt !== 'number' ||
        (item.status !== 'pending' &&
          item.status !== 'running' &&
          item.status !== 'succeeded' &&
          item.status !== 'failed' &&
          item.status !== 'rolled_back') ||
        typeof item.startedAt !== 'string'
      ) {
        return null;
      }
      return {
        attempt: item.attempt,
        status: item.status,
        startedAt: item.startedAt,
        ...(typeof item.completedAt === 'string' ? { completedAt: item.completedAt } : {}),
        ...(typeof item.errorMessage === 'string' ? { errorMessage: item.errorMessage } : {})
      } as MigrationRunAttempt;
    })
    .filter((attempt): attempt is MigrationRunAttempt => attempt !== null);
};

const parseRun = (value: Record<string, unknown>): MigrationRunRecord | null => {
  if (
    value.entityType !== 'MIGRATION_RUN' ||
    typeof value.runId !== 'string' ||
    typeof value.athleteId !== 'string' ||
    (value.scope !== 'entry-schema' && value.scope !== 'curriculum-schema' && value.scope !== 'curriculum-version') ||
    (value.status !== 'pending' &&
      value.status !== 'running' &&
      value.status !== 'succeeded' &&
      value.status !== 'failed' &&
      value.status !== 'rolled_back') ||
    typeof value.sourceVersion !== 'number' ||
    typeof value.targetVersion !== 'number' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    typeof value.startedBy !== 'string' ||
    typeof value.retries !== 'number'
  ) {
    return null;
  }

  return {
    runId: value.runId,
    athleteId: value.athleteId,
    scope: value.scope,
    status: value.status,
    sourceVersion: value.sourceVersion,
    targetVersion: value.targetVersion,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    startedBy: value.startedBy,
    retries: value.retries,
    attempts: normalizeAttempts(value.attempts),
    ...(typeof value.rollbackOfRunId === 'string' ? { rollbackOfRunId: value.rollbackOfRunId } : {}),
    ...(typeof value.lastErrorMessage === 'string' ? { lastErrorMessage: value.lastErrorMessage } : {})
  };
};

const recordToItem = (record: MigrationRunRecord): Record<string, unknown> => ({
  PK: `USER#${record.athleteId}`,
  SK: migrationRunSk(record.scope, record.runId),
  entityType: 'MIGRATION_RUN',
  ...record
});

export const getMigrationRun = async (
  athleteId: string,
  scope: MigrationScope,
  runId: string
): Promise<MigrationRunRecord | null> => {
  const found = await getItem({
    Key: {
      PK: `USER#${athleteId}`,
      SK: migrationRunSk(scope, runId)
    }
  });
  if (!found.Item) {
    return null;
  }
  return parseRun(found.Item as Record<string, unknown>);
};

export const putMigrationRun = async (record: MigrationRunRecord): Promise<void> => {
  await putItem({
    Item: recordToItem(record)
  });
};

export const listMigrationRuns = async (athleteId: string, scope?: MigrationScope): Promise<MigrationRunRecord[]> => {
  const prefix = scope ? `MIGRATION#${scope}#` : 'MIGRATION#';
  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${athleteId}`,
      ':prefix': prefix
    },
    ScanIndexForward: false
  });

  return (result.Items ?? [])
    .map((item) => parseRun(item as Record<string, unknown>))
    .filter((item): item is MigrationRunRecord => item !== null);
};

export const startMigrationRun = async (params: {
  athleteId: string;
  scope: MigrationScope;
  runId: string;
  sourceVersion: number;
  targetVersion: number;
  startedBy: string;
  nowIso: string;
}): Promise<MigrationRunRecord> => {
  const initialAttempt: MigrationRunAttempt = {
    attempt: 1,
    status: 'running',
    startedAt: params.nowIso
  };
  const record: MigrationRunRecord = {
    runId: params.runId,
    athleteId: params.athleteId,
    scope: params.scope,
    status: 'running',
    sourceVersion: params.sourceVersion,
    targetVersion: params.targetVersion,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    startedBy: params.startedBy,
    retries: 0,
    attempts: [initialAttempt]
  };
  await putMigrationRun(record);
  return record;
};

export const markMigrationRunStatus = async (params: {
  record: MigrationRunRecord;
  status: MigrationRunStatus;
  nowIso: string;
  errorMessage?: string;
}): Promise<MigrationRunRecord> => {
  const attempts = [...params.record.attempts];
  if (attempts.length > 0) {
    const last = attempts[attempts.length - 1];
    attempts[attempts.length - 1] = {
      ...last,
      status: params.status,
      completedAt: params.nowIso,
      ...(params.errorMessage ? { errorMessage: params.errorMessage } : {})
    };
  }

  const updated: MigrationRunRecord = {
    ...params.record,
    status: params.status,
    updatedAt: params.nowIso,
    attempts,
    ...(params.errorMessage ? { lastErrorMessage: params.errorMessage } : {})
  };

  await putMigrationRun(updated);
  return updated;
};

export const markMigrationRunRetry = async (params: {
  record: MigrationRunRecord;
  nowIso: string;
}): Promise<MigrationRunRecord> => {
  const nextAttemptNumber = params.record.attempts.length + 1;
  const updated: MigrationRunRecord = {
    ...params.record,
    status: 'running',
    retries: params.record.retries + 1,
    updatedAt: params.nowIso,
    attempts: [
      ...params.record.attempts,
      {
        attempt: nextAttemptNumber,
        status: 'running',
        startedAt: params.nowIso
      }
    ]
  };
  await putMigrationRun(updated);
  return updated;
};
