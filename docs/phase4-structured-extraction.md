# Phase 4: Structured extraction from free text with metadata confirmation

## Extraction schema

`Entry.structured` remains canonical and first-class for search/progress:

- `position`
- `technique`
- `outcome`
- `problem`
- `cue`
- `constraint` (manual optional)

`Entry.structuredExtraction` captures parser output + review state:

- `generatedAt`
- `suggestions[]`
  - `field`
  - `value`
  - `confidence` (`high` | `medium` | `low`)
  - `status` (`suggested` | `confirmed` | `corrected` | `rejected`)
  - `confirmationPrompt?`
  - `correctionValue?`
  - `note?`
  - `sourceExcerpt?` (athlete-only responses)
  - `updatedAt`
  - `updatedByRole?` (`athlete` | `coach`)
- `concepts[]`
- `failures[]`
- `conditioningIssues[]`
- `confidenceFlags[]` for non-high confidence fields

## Normalization rules

- Whitespace collapsed and trimmed for all extracted values.
- Canonical position/technique/outcome labels resolved from phrase dictionaries.
- `rawTechniqueMentions[0]` is treated as high-confidence technique when present.
- `structured` manual edits automatically become `corrected` confirmations when differing from suggestions.
- `structuredMetadataConfirmations` updates statuses in one step:
  - `confirmed`
  - `corrected` (requires `correctionValue`)
  - `rejected`
- Non-rejected high/medium suggestions are auto-applied into `structured` when missing.

## Service pipeline

Implemented in `backend/shared/structuredExtraction.ts`:

1. Aggregate free text from `quickAdd.notes`, shared/private sections, and raw technique mentions.
2. Extract candidates for `position`, `technique`, `outcome`, `problem`, `cue` via rule-based patterns.
3. Extract secondary metadata:
   - `concepts`
   - `failures`
   - `conditioningIssues`
4. Assign confidence (`high`/`medium`/`low`) per field.
5. Generate confirmation prompts for moderate/high confidence suggestions.
6. Apply user confirmations/corrections.
7. Persist canonical `structured` + `structuredExtraction` on create/update.

## API contract

### Entry create/update

`POST /entries` and `PUT /entries/{entryId}` accept:

- `structured?: EntryStructuredFields`
- `structuredMetadataConfirmations?: EntryStructuredMetadataConfirmation[]`

Response `entry` includes:

- `structured`
- `structuredExtraction`

### Coach/athlete structured review

`PUT /entries/{entryId}/structured-review`

Payload:

- `structured?: EntryStructuredFields`
- `confirmations?: EntryStructuredMetadataConfirmation[]`

Behavior:

- Athlete can review own entry.
- Linked coach can review/edit extracted structure.
- Persisted output updates both canonical `structured` and `structuredExtraction` status history.
- Coach responses strip private-derived excerpts and secondary lists (`concepts`, `failures`, `conditioningIssues`).
