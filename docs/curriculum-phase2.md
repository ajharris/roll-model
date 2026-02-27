# Curriculum Phase 2 Design

## New first-class entities

All entities are stored in the existing `RollModel` single table under `PK = USER#{athleteId}`.

### `CURRICULUM_STAGE`
- `SK = CURRICULUM_STAGE#{order}#{stageId}`
- Fields: `stageId`, `name`, `order`, `milestoneSkills`, `notes?`, `updatedAt`

### `CURRICULUM_SKILL`
- `SK = CURRICULUM_SKILL#{skillId}`
- Fields: `skillId`, `name`, `category`, `stageId`, `prerequisites`, `keyConcepts`, `commonFailures`, `drills`, `createdAt`, `updatedAt`

### `CURRICULUM_RELATIONSHIP`
- `SK = CURRICULUM_REL#FROM#{fromSkillId}#TO#{toSkillId}`
- Fields: `fromSkillId`, `toSkillId`, `relation`, `rationale?`, `createdAt`, `updatedAt`

### `CURRICULUM_PROGRESS`
- `SK = CURRICULUM_PROGRESS#{skillId}`
- Durable progression artifact fields:
  - `state`, `evidenceCount`, `confidence`
  - `rationale[]` (references extracted from GPT structured notes/checkoff evidence)
  - `sourceEntryIds[]`, `sourceEvidenceIds[]`
  - `suggestedNextSkillIds[]`
  - `manualOverrideState?`, `manualOverrideReason?`, `coachReviewedBy?`, `coachReviewedAt?`
  - `lastEvaluatedAt`

## Index strategy

`GSI1` is added:
- PK: `GSI1PK`
- SK: `GSI1SK`

Usage:
- Stage skill queries: skill rows write `GSI1PK = CURRICULUM_STAGE#{stageId}`.
- Reverse dependency traversal: relationship rows write `GSI1PK = CURRICULUM_DEPENDS_ON#{toSkillId}`.

Forward traversal remains efficient from base table (`CURRICULUM_REL#FROM#...` prefix).

## Validation and cycle rules

- Skill IDs and stage IDs are normalized slugs.
- `relation=prerequisite` graph must be acyclic.
- Cycles are rejected with `INVALID_REQUEST`.
- Non-prerequisite relations (`supports`, `counter`, `transition`) may form cycles.

## New APIs

- `GET /curriculum`
- `PUT /curriculum/stages`
- `POST /curriculum/seed`
- `PUT /curriculum/skills/{skillId}`
- `DELETE /curriculum/skills/{skillId}`
- `PUT /curriculum/relationships`
- `DELETE /curriculum/relationships/{fromSkillId}/{toSkillId}`
- `POST /curriculum/progress/recompute`
- `PUT /curriculum/progress/{skillId}/review`

All have athlete-scoped variants under `/athletes/{athleteId}/...` for coach/admin operations.

## Migration plan

1. Deploy schema and APIs
- Deploy CDK stack with `GSI1` and curriculum lambdas/routes.

2. Seed baseline curriculum
- Coach/admin runs `POST /curriculum/seed` (or `/athletes/{athleteId}/curriculum/seed`).
- Optional `{ "force": true }` to overwrite existing baseline rows.

3. Recompute progression artifacts
- Run `POST /curriculum/progress/recompute` to persist durable `CURRICULUM_PROGRESS` states.

4. Coach review loop
- Coaches can set manual overrides via `PUT /curriculum/progress/{skillId}/review`.

5. Backup/restore compatibility
- Curriculum stages/skills/relationships/progressions are included in export and restore envelopes.

## Seed baseline

Baseline seed data includes belt stages and starter dependencies (e.g., closed guard retention -> scissor sweep) in:
- `backend/shared/curriculumSeed.ts`

This provides an immediate initialization path and can be replaced with academy-specific data through the same APIs.
