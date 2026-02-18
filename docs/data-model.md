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

Stores identity and preferences controlled by the athlete.

### Coach-athlete link
- `PK = USER#{athleteId}`
- `SK = COACH#{coachId}`

Represents an athlete-authorized relationship that grants read/comment access to shared sections.

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

## Supporting access pattern item
To efficiently validate comment permissions, the backend also stores:
- `PK = ENTRY#{entryId}`
- `SK = META`
- attributes: `athleteId`, `createdAt`

This allows `postComment` to resolve the athlete owner from `entryId`, then verify `COACH` link existence.

## Access patterns implemented
1. Athlete gets own entries by querying `PK = USER#{athleteId}`, `begins_with(SK, ENTRY#)`.
2. Coach gets linked athlete entries with the same query after link validation.
3. Coach posts comment by checking `ENTRY#{entryId}/META` and `USER#{athleteId}/COACH#{coachId}`.
4. Athlete exports full data by querying own entries plus comments per `ENTRY#{entryId}` partition.
