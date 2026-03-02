import { ApiError } from './responses';

export interface MigrationStep<TPayload> {
  fromVersion: number;
  toVersion: number;
  label: string;
  migrate: (payload: TPayload) => TPayload;
  rollback?: (payload: TPayload) => TPayload;
}

export interface MigrationResult<TPayload> {
  sourceVersion: number;
  targetVersion: number;
  payload: TPayload;
  appliedSteps: string[];
}

const invalidMigration = (message: string): never => {
  throw new ApiError({
    code: 'INVALID_REQUEST',
    message,
    statusCode: 400
  });
};

export const migratePayload = <TPayload>(params: {
  sourceVersion: number;
  targetVersion: number;
  payload: TPayload;
  steps: Array<MigrationStep<TPayload>>;
}): MigrationResult<TPayload> => {
  const { sourceVersion, targetVersion, payload, steps } = params;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 0) {
    invalidMigration(`Invalid source version: ${String(sourceVersion)}.`);
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    invalidMigration(`Invalid target version: ${String(targetVersion)}.`);
  }

  if (sourceVersion === targetVersion) {
    return {
      sourceVersion,
      targetVersion,
      payload,
      appliedSteps: []
    };
  }

  if (sourceVersion > targetVersion) {
    invalidMigration(`Backward migration from ${String(sourceVersion)} to ${String(targetVersion)} is not supported.`);
  }

  const stepByFrom = new Map<number, MigrationStep<TPayload>>();
  for (const step of steps) {
    if (stepByFrom.has(step.fromVersion)) {
      invalidMigration(`Duplicate migration step from version ${String(step.fromVersion)}.`);
    }
    if (step.toVersion <= step.fromVersion) {
      invalidMigration(`Invalid migration step ${step.label}. toVersion must be greater than fromVersion.`);
    }
    stepByFrom.set(step.fromVersion, step);
  }

  let currentVersion = sourceVersion;
  let currentPayload = payload;
  const appliedSteps: string[] = [];
  while (currentVersion < targetVersion) {
    const step = stepByFrom.get(currentVersion);
    if (!step) {
      invalidMigration(`No migration step registered from version ${String(currentVersion)}.`);
    }
    const currentStep = step as MigrationStep<TPayload>;
    if (currentStep.toVersion > targetVersion) {
      invalidMigration(
        `Migration step ${currentStep.label} overshoots target version ${String(targetVersion)} from ${String(currentVersion)}.`
      );
    }
    currentPayload = currentStep.migrate(currentPayload);
    currentVersion = currentStep.toVersion;
    appliedSteps.push(currentStep.label);
  }

  return {
    sourceVersion,
    targetVersion,
    payload: currentPayload,
    appliedSteps
  };
};

export const rollbackMigration = <TPayload>(params: {
  sourceVersion: number;
  migratedPayload: TPayload;
  appliedSteps: string[];
  steps: Array<MigrationStep<TPayload>>;
}): TPayload => {
  const stepByLabel = new Map<string, MigrationStep<TPayload>>();
  for (const step of params.steps) {
    stepByLabel.set(step.label, step);
  }

  let payload = params.migratedPayload;
  for (let index = params.appliedSteps.length - 1; index >= 0; index -= 1) {
    const label = params.appliedSteps[index];
    const step = stepByLabel.get(label);
    if (!step || !step.rollback) {
      invalidMigration(`Rollback is not available for migration step "${label}".`);
    }
    payload = (step as MigrationStep<TPayload> & { rollback: (value: TPayload) => TPayload }).rollback(payload);
  }

  return payload;
};
