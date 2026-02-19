# Privacy Model and Coach Limitations

## Core principles
- Athlete data is owned by the athlete and partitioned by athlete ID.
- Coaches only ever see shared content.
- Coach access is granted per-athlete and must be explicitly linked.

## Role-based access
- **Athlete**: full access to their own entries, comments, and AI context (including private sections if `includePrivate=true`).
- **Coach**: can only access linked athletes; cannot view private sections or private keyword indexes.

## Entry visibility
- `sections.private` are never returned to coaches.
- `sections.shared` are the only entry text coaches can view.
- Comments are authored by coaches but only appear within the athlete's data export.

## AI context rules
- Coaches are forced to shared-only context even if they request private data.
- Private tokens are stored under `USER_PRIVATE#{athleteId}` and are never queried for coaches.
- Keyword retrieval for coaches uses only shared partitions and shared entry sections.

## Linking rules
- Coaches must be linked to an athlete to read entries or post comments.
- Link is stored as `USER#{athleteId} / COACH#{coachId}` and verified on each request.

## Audit and secrets
- OpenAI API key is stored in SSM and only the `aiChat` Lambda can access it.
- All API access is gated by Cognito JWTs and role claims.
