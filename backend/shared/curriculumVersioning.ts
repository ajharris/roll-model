import { randomUUID } from 'crypto';

import { getItem, putItem } from './db';
import { CURRENT_ENTRY_SCHEMA_VERSION } from './entries';
import { markMigrationRunRetry, markMigrationRunStatus, startMigrationRun } from './migrationStore';
import { ApiError } from './responses';
import type {
  CurriculumRecommendation,
  CurriculumVersionDefinition,
  CurriculumVersionState,
  Entry,
  MigrationRunRecord
} from './types';

export const CURRICULUM_VERSION_REGISTRY: Record<number, CurriculumVersionDefinition> = {
  1: {
    version: 1,
    name: 'curriculum-v1-stable',
    workflowContract: 'capture-outputs-coach-review-storage-v1',
    compatibility: {
      minEntrySchemaVersion: 2,
      maxEntrySchemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
      requiresRecommendationSourceEvidence: true,
      requiresSessionReviewCue: true
    }
  }
};

export const CURRENT_CURRICULUM_VERSION = 1;
const CURRICULUM_VERSION_ACTIVE_SK = 'CURRICULUM_VERSION#ACTIVE';

const parseCurriculumVersionState = (item: Record<string, unknown>): CurriculumVersionState | null => {
  if (
    item.entityType !== 'CURRICULUM_VERSION' ||
    typeof item.athleteId !== 'string' ||
    typeof item.version !== 'number' ||
    (item.status !== 'active' && item.status !== 'rolling_out' && item.status !== 'failed' && item.status !== 'rolling_back') ||
    typeof item.activatedAt !== 'string' ||
    typeof item.updatedAt !== 'string' ||
    typeof item.updatedBy !== 'string'
  ) {
    return null;
  }

  return {
    athleteId: item.athleteId,
    version: item.version,
    status: item.status,
    activatedAt: item.activatedAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
    ...(typeof item.previousVersion === 'number' ? { previousVersion: item.previousVersion } : {}),
    ...(typeof item.rolloutRunId === 'string' ? { rolloutRunId: item.rolloutRunId } : {}),
    ...(typeof item.lastError === 'string' ? { lastError: item.lastError } : {})
  };
};

const defaultCurriculumVersionState = (athleteId: string): CurriculumVersionState => {
  const nowIso = new Date().toISOString();
  return {
    athleteId,
    version: CURRENT_CURRICULUM_VERSION,
    status: 'active',
    activatedAt: nowIso,
    updatedAt: nowIso,
    updatedBy: 'system'
  };
};

export const getCurriculumVersionState = async (athleteId: string): Promise<CurriculumVersionState> => {
  const result = await getItem({
    Key: {
      PK: `USER#${athleteId}`,
      SK: CURRICULUM_VERSION_ACTIVE_SK
    }
  });

  if (!result.Item) {
    return defaultCurriculumVersionState(athleteId);
  }
  return parseCurriculumVersionState(result.Item as Record<string, unknown>) ?? defaultCurriculumVersionState(athleteId);
};

export const putCurriculumVersionState = async (state: CurriculumVersionState): Promise<void> => {
  await putItem({
    Item: {
      PK: `USER#${state.athleteId}`,
      SK: CURRICULUM_VERSION_ACTIVE_SK,
      entityType: 'CURRICULUM_VERSION',
      ...state
    }
  });
};

const compatibilityError = (message: string): never => {
  throw new ApiError({
    code: 'INCOMPATIBLE_CURRICULUM_VERSION',
    message,
    statusCode: 409
  });
};

const hasSessionReviewCue = (entry: Entry): boolean => {
  const draftCue = entry.sessionReviewDraft?.oneThing?.trim();
  const finalCue = entry.sessionReviewFinal?.review.oneThing?.trim();
  return Boolean(draftCue || finalCue);
};

const hasRecommendationEvidence = (recommendation: CurriculumRecommendation): boolean =>
  Array.isArray(recommendation.sourceEvidence) && recommendation.sourceEvidence.length > 0;

export const assertCurriculumCompatibility = (params: {
  curriculumVersion: number;
  entries: Entry[];
  recommendations: CurriculumRecommendation[];
}): void => {
  const definition = CURRICULUM_VERSION_REGISTRY[params.curriculumVersion];
  if (!definition) {
    compatibilityError(`Curriculum version ${String(params.curriculumVersion)} is not registered.`);
  }

  for (const entry of params.entries) {
    if (
      entry.schemaVersion < definition.compatibility.minEntrySchemaVersion ||
      entry.schemaVersion > definition.compatibility.maxEntrySchemaVersion
    ) {
      compatibilityError(
        `Entry ${entry.entryId} schemaVersion ${String(entry.schemaVersion)} is incompatible with curriculum version ${String(
          params.curriculumVersion
        )}.`
      );
    }
  }

  if (definition.compatibility.requiresSessionReviewCue) {
    const invalidEntry = params.entries.find(
      (entry) => (entry.sessionReviewDraft || entry.sessionReviewFinal) && !hasSessionReviewCue(entry)
    );
    if (invalidEntry) {
      compatibilityError(
        `Entry ${invalidEntry.entryId} is missing session review cue required by curriculum version ${String(
          params.curriculumVersion
        )}.`
      );
    }
  }

  if (definition.compatibility.requiresRecommendationSourceEvidence) {
    const invalidRecommendation = params.recommendations.find((recommendation) => !hasRecommendationEvidence(recommendation));
    if (invalidRecommendation) {
      compatibilityError(
        `Recommendation ${invalidRecommendation.recommendationId} is missing sourceEvidence required by curriculum version ${String(
          params.curriculumVersion
        )}.`
      );
    }
  }
};

export const beginCurriculumRollout = async (params: {
  athleteId: string;
  run: MigrationRunRecord;
  targetVersion: number;
  nowIso: string;
}): Promise<CurriculumVersionState> => {
  const current = await getCurriculumVersionState(params.athleteId);
  const nextState: CurriculumVersionState = {
    athleteId: params.athleteId,
    version: params.targetVersion,
    status: 'rolling_out',
    activatedAt: current.activatedAt,
    updatedAt: params.nowIso,
    updatedBy: params.run.startedBy,
    previousVersion: current.version,
    rolloutRunId: params.run.runId
  };
  await putCurriculumVersionState(nextState);
  return nextState;
};

export const completeCurriculumRollout = async (params: {
  athleteId: string;
  run: MigrationRunRecord;
  targetVersion: number;
  nowIso: string;
}): Promise<CurriculumVersionState> => {
  const current = await getCurriculumVersionState(params.athleteId);
  const nextState: CurriculumVersionState = {
    athleteId: params.athleteId,
    version: params.targetVersion,
    status: 'active',
    activatedAt: params.nowIso,
    updatedAt: params.nowIso,
    updatedBy: params.run.startedBy,
    previousVersion: current.previousVersion ?? current.version,
    rolloutRunId: params.run.runId
  };
  await putCurriculumVersionState(nextState);
  return nextState;
};

export const failCurriculumRollout = async (params: {
  athleteId: string;
  run: MigrationRunRecord;
  nowIso: string;
  errorMessage: string;
}): Promise<CurriculumVersionState> => {
  const current = await getCurriculumVersionState(params.athleteId);
  const rollbackVersion = current.previousVersion ?? CURRENT_CURRICULUM_VERSION;
  const nextState: CurriculumVersionState = {
    athleteId: params.athleteId,
    version: rollbackVersion,
    status: 'failed',
    activatedAt: current.activatedAt,
    updatedAt: params.nowIso,
    updatedBy: params.run.startedBy,
    previousVersion: rollbackVersion,
    rolloutRunId: params.run.runId,
    lastError: params.errorMessage
  };
  await putCurriculumVersionState(nextState);
  return nextState;
};

export const runCurriculumVersionedMutation = async <TResult>(params: {
  athleteId: string;
  startedBy: string;
  sourceVersion: number;
  targetVersion?: number;
  maxAttempts?: number;
  execute: () => Promise<TResult>;
}): Promise<{ result: TResult; run: MigrationRunRecord; versionState: CurriculumVersionState }> => {
  const targetVersion = params.targetVersion ?? params.sourceVersion;
  if (!CURRICULUM_VERSION_REGISTRY[targetVersion]) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: `Target curriculum version ${String(targetVersion)} is not registered.`,
      statusCode: 400
    });
  }

  const maxAttempts = Math.max(1, params.maxAttempts ?? 2);
  const runId = randomUUID();
  let run = await startMigrationRun({
    athleteId: params.athleteId,
    scope: 'curriculum-version',
    runId,
    sourceVersion: params.sourceVersion,
    targetVersion,
    startedBy: params.startedBy,
    nowIso: new Date().toISOString()
  });

  await beginCurriculumRollout({
    athleteId: params.athleteId,
    run,
    targetVersion,
    nowIso: new Date().toISOString()
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await params.execute();
      run = await markMigrationRunStatus({
        record: run,
        status: 'succeeded',
        nowIso: new Date().toISOString()
      });
      const versionState = await completeCurriculumRollout({
        athleteId: params.athleteId,
        run,
        targetVersion,
        nowIso: new Date().toISOString()
      });
      return { result, run, versionState };
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : 'Unknown migration failure.';
      run = await markMigrationRunStatus({
        record: run,
        status: 'failed',
        nowIso: new Date().toISOString(),
        errorMessage
      });
      if (attempt < maxAttempts) {
        run = await markMigrationRunRetry({
          record: run,
          nowIso: new Date().toISOString()
        });
      }
    }
  }

  await failCurriculumRollout({
    athleteId: params.athleteId,
    run,
    nowIso: new Date().toISOString(),
    errorMessage: lastError instanceof Error ? lastError.message : 'Unknown migration failure.'
  });
  throw lastError instanceof Error
    ? lastError
    : new ApiError({
        code: 'MIGRATION_FAILED',
        message: 'Curriculum version migration failed.',
        statusCode: 500
      });
};
