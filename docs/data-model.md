# Roll Model DynamoDB Single-Table Design

## Table
- **Table name**: `RollModel`
- **Primary key**:
  - `PK` (string)
  - `SK` (string)
- **Billing mode**: on-demand (`PAY_PER_REQUEST`)

## Entity patterns

### User profile
- `PK = USER#{userId}`
- `SK = PROFILE`

### Coach-athlete link
- `PK = USER#{athleteId}`
- `SK = COACH#{coachId}`

### Entry
- `PK = USER#{athleteId}`
- `SK = ENTRY#{ISODate}#{entryId}`

Entry attributes:
- `entryId`
- `athleteId`
- `createdAt`
- `updatedAt`
- `sections`
  - `private: string`
  - `shared: string`
- `sessionMetrics`
  - `durationMinutes: number`
  - `intensity: number`
  - `rounds: number`
  - `giOrNoGi: string`
  - `tags: string[]`

### Comment
- `PK = ENTRY#{entryId}`
- `SK = COMMENT#{ISODate}#{commentId}`

Comment attributes:
- `commentId`
- `entryId`
- `coachId`
- `createdAt`
- `body`
- `visibility: visible | hiddenByAthlete`

### AI thread
- `PK = USER#{userId}`
- `SK = AI_THREAD#{threadId}`
- `entityType = AI_THREAD`
- attributes: `threadId`, `title`, `createdAt`, `lastActiveAt`

### AI message
- `PK = AI_THREAD#{threadId}`
- `SK = MSG#{ISODate}#{messageId}`
- `entityType = AI_MESSAGE`
- attributes: `messageId`, `threadId`, `role`, `content`, `visibilityScope`, `createdAt`


### Keyword index
- `PK = USER#{athleteId}`
- `SK = KW#{token}#TS#{createdAt}#ENTRY#{entryId}`
- `entityType = KEYWORD_INDEX`
- attributes: `entryId`, `createdAt`

## Supporting access pattern item
To validate comment permissions:
- `PK = ENTRY#{entryId}`
- `SK = META`
- attributes: `athleteId`, `createdAt`

## Access patterns implemented
1. Athlete gets own entries by querying `PK = USER#{athleteId}`, `begins_with(SK, ENTRY#)`.
2. Coach gets linked athlete entries with the same query after link validation.
3. Coach posts comment by checking `ENTRY#{entryId}/META` and `USER#{athleteId}/COACH#{coachId}`.
4. Athlete exports full data by querying own entries plus comments per `ENTRY#{entryId}` partition.
5. Athlete/coach AI chat stores conversation messages under `AI_THREAD#{threadId}` while preserving visibility scope (`private` vs `shared`).
6. Keyword retrieval uses `USER#{athleteId}` + `KW#{token}#TS#...` records to quickly find matching entries by token recency.
