# Roll Model DynamoDB Single-Table Design

## Table
- **Table name**: `RollModel`
- **Primary key**: `PK` (string), `SK` (string)
- **Billing mode**: on-demand (`PAY_PER_REQUEST`)
- **PITR**: enabled

## Entity list
- Entry
- Entry meta
- Coach-athlete link
- Comment
- AI thread
- AI message
- Keyword index (shared)
- Keyword index (private)

## PK/SK patterns
- **Coach-athlete link**: `PK = USER#{athleteId}`, `SK = COACH#{coachId}`
- **Entry**: `PK = USER#{athleteId}`, `SK = ENTRY#{ISODate}#{entryId}`
- **Entry meta**: `PK = ENTRY#{entryId}`, `SK = META`
- **Comment**: `PK = ENTRY#{entryId}`, `SK = COMMENT#{ISODate}#{commentId}`
- **AI thread**: `PK = USER#{userId}`, `SK = AI_THREAD#{threadId}`
- **AI message**: `PK = AI_THREAD#{threadId}`, `SK = MSG#{ISODate}#{messageId}`
- **Keyword index (shared)**: `PK = USER#{athleteId}`, `SK = KW#{token}#TS#{createdAt}#ENTRY#{entryId}`
- **Keyword index (private)**: `PK = USER_PRIVATE#{athleteId}`, `SK = KW#{token}#TS#{createdAt}#ENTRY#{entryId}`

## Attributes
### Entry
- `entryId`, `athleteId`, `createdAt`, `updatedAt`
- `sections.private`, `sections.shared`
- `sessionMetrics.durationMinutes`, `sessionMetrics.intensity`, `sessionMetrics.rounds`, `sessionMetrics.giOrNoGi`, `sessionMetrics.tags`

### Entry meta
- `athleteId`, `createdAt`

### Coach-athlete link
- `athleteId`, `coachId`, `createdAt`

### Comment
- `commentId`, `entryId`, `coachId`, `createdAt`, `body`, `visibility`

### AI thread
- `threadId`, `title`, `createdAt`, `lastActiveAt`

### AI message
- `messageId`, `threadId`, `role`, `content`, `visibilityScope`, `createdAt`

### Keyword index
- `entryId`, `createdAt`, `visibilityScope`

## Example items
### Entry
```json
{
  "PK": "USER#athlete-123",
  "SK": "ENTRY#2026-02-19T12:00:00.000Z#entry-abc",
  "entityType": "ENTRY",
  "entryId": "entry-abc",
  "athleteId": "athlete-123",
  "createdAt": "2026-02-19T12:00:00.000Z",
  "updatedAt": "2026-02-19T12:00:00.000Z",
  "sections": {
    "private": "Felt exhausted today...",
    "shared": "Worked guard retention and frames."
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

### Entry meta
```json
{
  "PK": "ENTRY#entry-abc",
  "SK": "META",
  "entityType": "ENTRY_META",
  "athleteId": "athlete-123",
  "createdAt": "2026-02-19T12:00:00.000Z"
}
```

### Coach-athlete link
```json
{
  "PK": "USER#athlete-123",
  "SK": "COACH#coach-999",
  "entityType": "COACH_LINK",
  "athleteId": "athlete-123",
  "coachId": "coach-999",
  "createdAt": "2026-02-19T12:05:00.000Z"
}
```

### Comment
```json
{
  "PK": "ENTRY#entry-abc",
  "SK": "COMMENT#2026-02-19T12:30:00.000Z#comment-456",
  "entityType": "COMMENT",
  "commentId": "comment-456",
  "entryId": "entry-abc",
  "coachId": "coach-999",
  "createdAt": "2026-02-19T12:30:00.000Z",
  "body": "Good focus on frames. Add hip-escape reps.",
  "visibility": "visible"
}
```

### AI thread
```json
{
  "PK": "USER#athlete-123",
  "SK": "AI_THREAD#thread-555",
  "entityType": "AI_THREAD",
  "threadId": "thread-555",
  "title": "Training Reflection",
  "createdAt": "2026-02-19T12:10:00.000Z",
  "lastActiveAt": "2026-02-19T12:10:00.000Z"
}
```

### AI message
```json
{
  "PK": "AI_THREAD#thread-555",
  "SK": "MSG#2026-02-19T12:11:00.000Z#msg-777",
  "entityType": "AI_MESSAGE",
  "messageId": "msg-777",
  "threadId": "thread-555",
  "role": "assistant",
  "content": "{\"text\":\"...\",\"extracted_updates\":{...},\"suggested_prompts\":[...]}" ,
  "visibilityScope": "shared",
  "createdAt": "2026-02-19T12:11:00.000Z"
}
```

### Keyword index (shared)
```json
{
  "PK": "USER#athlete-123",
  "SK": "KW#guard#TS#2026-02-19T12:00:00.000Z#ENTRY#entry-abc",
  "entityType": "KEYWORD_INDEX",
  "visibilityScope": "shared",
  "entryId": "entry-abc",
  "createdAt": "2026-02-19T12:00:00.000Z"
}
```

### Keyword index (private)
```json
{
  "PK": "USER_PRIVATE#athlete-123",
  "SK": "KW#injury#TS#2026-02-19T12:00:00.000Z#ENTRY#entry-abc",
  "entityType": "KEYWORD_INDEX",
  "visibilityScope": "private",
  "entryId": "entry-abc",
  "createdAt": "2026-02-19T12:00:00.000Z"
}
```

## Access patterns
1. Athlete lists own entries: query `PK = USER#{athleteId}`, `begins_with(SK, ENTRY#)`.
2. Coach lists linked athlete entries: same query after link validation.
3. Post comment: validate `ENTRY#{entryId}/META` and link `USER#{athleteId}/COACH#{coachId}`.
4. Export: query entries by athlete, then comments by entry.
5. AI chat: store threads/messages under `USER#{userId}` and `AI_THREAD#{threadId}`.
6. Keyword retrieval: query `USER#{athleteId}` (shared) or `USER_PRIVATE#{athleteId}` (private) with `KW#{token}` prefix.

## Privacy notes
See `docs/privacy.md` for the full privacy model, including coach limitations and AI visibility rules.
