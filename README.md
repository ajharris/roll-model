# Roll Model

Roll Model is a scientific Brazilian Jiu Jitsu journaling and
performance intelligence system.

It combines: - Structured training logs - Private athlete-owned notes -
Coach-shared collaboration - AI-assisted analysis - Exportable JSON
datasets - Analytics-ready data structures

The goal is simple: evidence over vibes.

------------------------------------------------------------------------

## Core Principles

-   The athlete owns their data.
-   Private notes are never visible to coaches.
-   Coaches may comment but cannot edit or delete athlete entries.
-   AI operates server-side only.
-   All structured data is exportable for independent analysis.

------------------------------------------------------------------------

## Architecture Overview

### Backend (Serverless AWS)

-   AWS CDK infrastructure
-   API Gateway (REST)
-   AWS Lambda (TypeScript)
-   Amazon Cognito (User Pools with role-based access)
-   DynamoDB (single-table design)
-   SSM Parameter Store (OpenAI key storage)

### Frontend

-   Next.js (App Router)
-   TypeScript
-   Cognito authentication
-   Typed API client
-   Scientific UX tone
-   Minimal analytics dashboards

------------------------------------------------------------------------

## Authentication Model

Roles are enforced via Cognito custom attribute:

-   `custom:role = athlete`
-   `custom:role = coach`

### Athlete Permissions

-   Create entries
-   View private + shared notes
-   Link coaches
-   Export data
-   Use AI features

### Coach Permissions

-   View shared notes only
-   Post comments
-   Cannot edit or delete entries
-   Cannot access private sections

------------------------------------------------------------------------

## Data Model (Simplified)

### Entry

-   entryId
-   athleteId
-   createdAt
-   updatedAt
-   sections:
    -   private
    -   shared
-   sessionMetrics:
    -   durationMinutes
    -   intensity
    -   rounds
    -   giOrNoGi
    -   tags\[\]
-   rawTechniqueMentions\[\]

### Comment

-   PK = ENTRY#{entryId}
-   SK = COMMENT#{timestamp}
-   body
-   coachId

### Keyword Index

-   Enables keyword-based context retrieval for AI
-   PK = USER#{athleteId}
-   SK = KW#{token}#TS#{timestamp}#ENTRY#{entryId}

------------------------------------------------------------------------

## Backend Setup

Install dependencies:

``` bash
npm install
npm run build
npm test
```

Deploy infrastructure:

``` bash
cd infrastructure/cdk
cdk deploy
```

------------------------------------------------------------------------

## Frontend Setup

``` bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Production build:

``` bash
npm run build
```

------------------------------------------------------------------------

## Required Environment Variables (Frontend)

See `frontend/.env.example`

Typical values:

-   NEXT_PUBLIC_API_BASE_URL
-   NEXT_PUBLIC_COGNITO_USER_POOL_ID
-   NEXT_PUBLIC_COGNITO_CLIENT_ID
-   NEXT_PUBLIC_COGNITO_DOMAIN (if using Hosted UI)
-   NEXT_PUBLIC_COGNITO_REDIRECT_URI

------------------------------------------------------------------------

## AI Integration

-   All OpenAI calls occur server-side.
-   API key stored in AWS SSM Parameter Store:
    `/roll-model/openai_api_key`
-   AI responses return:
    -   assistant_text (natural language coaching)
    -   extracted_updates (structured JSON)
    -   suggested_prompts

AI chat supports: - Recency-based context (last N entries) -
Keyword-based retrieval - Privacy-aware filtering

------------------------------------------------------------------------

## JSON Export

Athletes can export their data via:

    GET /export

Export includes: - Entries - Comments - Links - AI outputs (if
present) - schemaVersion - generatedAt

Export supports downstream use in: - Python - Pandas - Jupyter - ML
pipelines

------------------------------------------------------------------------

## Scientific Direction

Roll Model is designed to enable:

-   Load tracking over time
-   Injury signal detection
-   Technique exposure analysis
-   Correlation modeling
-   Community-level anonymized trend analysis (opt-in)

Future extensions include: - Controlled technique vocabulary - Technique
alias mapping - Injury prediction signals - Weekly lab-style training
reports

------------------------------------------------------------------------

## Security Notes

-   No OpenAI calls from frontend.
-   Tokens are not stored in localStorage.
-   Private sections never exposed to coaches.
-   All access is role-verified server-side.

------------------------------------------------------------------------

## Development Roadmap (High Level)

1.  Backend stabilization
2.  AI chat integration
3.  Frontend v1 complete workflow
4.  Analytics dashboard expansion
5.  Technique vocabulary mining
6.  ML experimentation layer

------------------------------------------------------------------------

Roll Model Scientific grappling. Structured reflection. Intelligent
progression.
