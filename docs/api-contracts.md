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

## `GET /entries`
- **Role**: `athlete`
- Returns full entries.

## `GET /athletes/{athleteId}/entries`
- **Role**: `coach`
- Returns linked athlete entries with shared sections only.

## `POST /entries/comments`
- **Role**: `coach`
- **Body**:
```json
{
  "entryId": "string",
  "body": "string"
}
```

## `POST /links/coach`
- **Role**: `athlete`
- **Body**:
```json
{
  "coachId": "string"
}
```

## `GET /export`
- **Role**: `athlete`
- Returns `full` and `tidy` JSON exports.

## `POST /ai/chat`
Chat endpoint for AI-assisted post-training analysis.

- **Role**: `athlete` or `coach`
- **Body**:
```json
{
  "threadId": "optional",
  "message": "string",
  "context": {
    "athleteId": "required for coach",
    "entryIds": ["optional"],
    "dateRange": {"from": "optional", "to": "optional"},
    "includePrivate": true,
    "keywords": ["guard retention", "turtle"]
  }
}
```

Rules:
- Athlete may set `includePrivate=true`.
- Coach is forced to shared-only context (`includePrivate` ignored/forced false) and must be linked to target athlete.

- **Response**:
```json
{
  "threadId": "string",
  "assistant_text": "string",
  "extracted_updates": {
    "summary": "string",
    "detectedTopics": ["string"],
    "recommendedIntensity": 7,
    "followUpActions": ["string"]
  },
  "suggested_prompts": ["string"]
}
```

## Error format
```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable"
  }
}
```


Keyword retrieval behavior:
- Default context uses latest 10 entries plus latest 20 messages in the thread.
- When `context.keywords` is supplied, keywords are tokenized and matched against per-entry keyword index items; top entries are ranked by keyword overlap then recency.
