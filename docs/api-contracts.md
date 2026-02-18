# API Contracts (v1)

All endpoints require Cognito JWT auth and are fronted by API Gateway REST API.

## `POST /entries`
Create a training entry.
- **Role**: `athlete`
- **Body**:
```json
{
  "sections": {
    "private": "string",
    "shared": "string"
  },
  "sessionMetrics": {
    "durationMinutes": 90,
    "intensity": 7,
    "rounds": 8,
    "giOrNoGi": "gi",
    "tags": ["guard", "sparring"]
  }
}
```
- **Response**: `201` with `{ entry }`

## `GET /entries`
Get entries for current athlete.
- **Role**: `athlete`
- **Response**: `200` with full entry payloads.

## `GET /athletes/{athleteId}/entries`
Get entries for linked athlete.
- **Role**: `coach`
- **Response**: `200` with shared sections only.

## `POST /entries/comments`
Post comment on an entry.
- **Role**: `coach`
- **Body**:
```json
{
  "entryId": "string",
  "body": "string"
}
```
- **Response**: `201` with `{ comment }`

## `POST /links/coach`
Athlete links coach.
- **Role**: `athlete`
- **Body**:
```json
{
  "coachId": "string"
}
```
- **Response**: `201` with link confirmation.

## `GET /export`
Athlete data export.
- **Role**: `athlete`
- **Response**: `200` with:
  - `full`: nested JSON export
  - `tidy`: normalized arrays for analytics ingestion

## Error format
```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable"
  }
}
```
