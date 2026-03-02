# Phase 6 Migration And Curriculum Versioning Playbook

## Goals
- Keep historical structured GPT outputs readable/queryable across schema changes.
- Preserve contract continuity: `capture -> outputs -> optional coach review -> storage`.
- Provide deterministic rollout and rollback behavior for curriculum and schema updates.
- Persist migration telemetry for monitoring and retry workflows.

## Version Registry
- Entry schema migrations are versioned through explicit steps (`v0 -> v2 -> v3 -> v4 -> v5`) in `backend/shared/entries.ts`.
- Curriculum compatibility registry is defined in `backend/shared/curriculumVersioning.ts`.
- Active curriculum version is stored in `CURRICULUM_VERSION#ACTIVE`.

## Rollout Procedure
1. Confirm target schema/curriculum versions are present in the registry.
2. Start rollout (`runCurriculumVersionedMutation`) which writes `MIGRATION_RUN` with `running` status.
3. Apply curriculum changes.
4. Run compatibility checks against live entries/recommendations.
5. Mark rollout `succeeded` and set curriculum version state to `active`.

## Automatic Rollback
- On compatibility/write failure:
  - previous curriculum snapshot is restored (`replaceCurriculumSnapshot`)
  - migration status is set to `failed`
  - curriculum version state is moved to `failed` and tracks last error
- Rollback is best-effort and executed within the same request to minimize user-visible drift.

## Retry Rules
- Curriculum migrations retry once by default (`maxAttempts=2`).
- Retries append attempt metadata to `MIGRATION_RUN.attempts[]` and increment `retries`.

## Monitoring Checklist
- Alert when any `MIGRATION_RUN.status = failed`.
- Alert when `CURRICULUM_VERSION#ACTIVE.status != active`.
- Track retry counts and error messages for repeated failures.

## Compatibility Policy
- Forward-compatible additive changes can keep existing major version if normalizers can fill defaults deterministically.
- Breaking changes require:
  - version bump
  - explicit migration step
  - rollback behavior
  - test coverage for migration correctness/idempotency/rollback
