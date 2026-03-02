import { migratePayload, rollbackMigration, type MigrationStep } from './migrations';
import { ApiError } from './responses';

type Payload = { schemaVersion?: number; values: string[] };

const steps: Array<MigrationStep<Payload>> = [
  {
    fromVersion: 0,
    toVersion: 1,
    label: 'v0-v1',
    migrate: (payload) => ({ ...payload, schemaVersion: 1, values: [...payload.values, 'v1'] }),
    rollback: (payload) => ({ ...payload, schemaVersion: 0, values: payload.values.filter((item) => item !== 'v1') })
  },
  {
    fromVersion: 1,
    toVersion: 2,
    label: 'v1-v2',
    migrate: (payload) => ({ ...payload, schemaVersion: 2, values: [...payload.values, 'v2'] }),
    rollback: (payload) => ({ ...payload, schemaVersion: 1, values: payload.values.filter((item) => item !== 'v2') })
  }
];

describe('migratePayload', () => {
  it('applies sequential migration steps', () => {
    const result = migratePayload({
      sourceVersion: 0,
      targetVersion: 2,
      payload: { values: [] },
      steps
    });

    expect(result.appliedSteps).toEqual(['v0-v1', 'v1-v2']);
    expect(result.payload.schemaVersion).toBe(2);
    expect(result.payload.values).toEqual(['v1', 'v2']);
  });

  it('is idempotent when source and target versions match', () => {
    const payload = { schemaVersion: 2, values: ['already-migrated'] };
    const result = migratePayload({
      sourceVersion: 2,
      targetVersion: 2,
      payload,
      steps
    });
    expect(result.appliedSteps).toEqual([]);
    expect(result.payload).toBe(payload);
  });

  it('fails with clear error when step chain is incomplete', () => {
    expect(() =>
      migratePayload({
        sourceVersion: 0,
        targetVersion: 3,
        payload: { values: [] },
        steps
      })
    ).toThrow(ApiError);
  });
});

describe('rollbackMigration', () => {
  it('rolls back applied migration steps in reverse order', () => {
    const migrated = migratePayload({
      sourceVersion: 0,
      targetVersion: 2,
      payload: { values: [] },
      steps
    });

    const rolledBack = rollbackMigration({
      sourceVersion: 0,
      migratedPayload: migrated.payload,
      appliedSteps: migrated.appliedSteps,
      steps
    });

    expect(rolledBack.schemaVersion).toBe(0);
    expect(rolledBack.values).toEqual([]);
  });
});
