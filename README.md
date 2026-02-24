# Roll Model (BJJ Lab Notebook)

BJJ Lab Notebook is a scientific Brazilian Jiu Jitsu journaling and
performance intelligence system.

Hosted at: [BJJLab](https://main.d15hzi11jeckui.amplifyapp.com/)

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


## Current Project State

As of this codebase snapshot, the platform includes:

- Athlete training entries with private/shared sections.
- Coach-athlete link management (link + revoke).
- Coach comments on entries.
- AI chat with privacy-aware retrieval, thread/message storage, and structured outputs.
- Athlete export endpoint with `full` and `tidy` modes.
- Public signup request intake (SES email notification flow).
- Authenticated feedback submission that opens GitHub issues.
- Next.js frontend flows for entries, chat, analytics view, export, coaching, signup requests, and feedback.

## Architecture

### Backend (AWS Serverless, CDK)

- API Gateway (REST API, `prod` stage).
- Lambda (TypeScript, Node.js 20).
- Cognito User Pool + User Pool Client.
- DynamoDB single-table design (`RollModel`, PITR enabled).
- SSM Parameter Store for OpenAI key: `/roll-model/openai_api_key`.
- SES integration for signup request notifications.

### Frontend

- Next.js App Router (v14).
- React + TypeScript.
- Cognito-based auth flow.
- Typed API client in `frontend/src/lib/apiClient.ts`.

## Authentication Model

Roles are enforced using Cognito custom attribute `custom:role`.

- `athlete`: create/view entries, link/revoke coaches, export data, use AI chat.
- `coach`: view linked athlete shared entries only, comment on entries, use AI chat with shared-only context.

## API Surface (Implemented)

- `POST /entries`
- `GET /entries`
- `GET /athletes/{athleteId}/entries`
- `POST /entries/comments`
- `POST /links/coach`
- `DELETE /links/coach`
- `GET /export`
- `POST /ai/chat`
- `POST /signup-requests` (public)
- `POST /feedback` (authenticated)

Reference docs:

- `docs/architecture.md`
- `docs/api-contracts.md`
- `docs/privacy.md`
- `docs/data-model.md`

## Repository Layout

- `backend/` Lambda handlers + shared domain modules + Jest tests.
- `infrastructure/cdk/` AWS CDK stack (`RollModelStack`).
- `frontend/` Next.js frontend + Vitest tests.
- `docs/` architecture, contracts, privacy, and data model docs.

## Local Development

### Prerequisites

- Node.js 20+
- npm
- AWS credentials/profile (for CDK deploy/synth against your account)

### Install and verify (repo root)

```bash
npm ci
npm run setup:codex
npm run lint
npm run test
npm run build
```

`npm run setup:codex` configures `origin` automatically when a remote URL is available in environment variables such as `CODEX_GIT_REMOTE_URL`, `CODEX_REMOTE_URL`, `GIT_REMOTE_URL`, `REPOSITORY_URL`, or `GITHUB_REPOSITORY`.

### Run frontend

```bash
cd frontend
npm ci
npm run dev
```

Set frontend environment variables (example names):

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_COGNITO_DOMAIN` (optional)
- `NEXT_PUBLIC_COGNITO_REDIRECT_URI` (optional)

## Infrastructure and Deploy

### CDK

From repo root:

```bash
npm run cdk:synth
npm run cdk:deploy
```

Stack outputs include:

- `ApiUrl`
- `UserPoolId`
- `UserPoolClientId`
- `TableName`

### CI/CD

- `/.github/workflows/ci.yml`
  - Runs CDK synth.
  - Runs backend lint/test/build.
  - Runs frontend lint/test/build.
- `/.github/workflows/deploy.yml`
  - Triggers after successful CI on `main`.
  - Assumes AWS role and deploys CDK.

Frontend deploy is managed by AWS Amplify using `amplify.yml`.

### GitHub Actions AWS Auth (OIDC)

Backend deploy workflow uses GitHub OIDC + `aws-actions/configure-aws-credentials`.

- Role currently assumed in deploy workflow:
  - `arn:aws:iam::864981757594:role/roll-model-github-actions`
- Region currently used:
  - `us-east-1`

Recommended trust policy scope: restrict to this repo + `main` branch.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

If deploy permissions are too narrow, expand incrementally across CloudFormation, Lambda, API Gateway, DynamoDB, Cognito, SSM, and CDK bootstrap asset roles/resources.

### IAM Policy Examples For Deploy Role

Option A is broader and easier to get working quickly. Option B is tighter and scoped to this stack and CDK bootstrap resources.

#### Option A: Baseline (broad)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "cloudformation:*", "Resource": "*" },
    { "Effect": "Allow", "Action": "lambda:*", "Resource": "*" },
    { "Effect": "Allow", "Action": "apigateway:*", "Resource": "*" },
    { "Effect": "Allow", "Action": "dynamodb:*", "Resource": "*" },
    { "Effect": "Allow", "Action": "cognito-idp:*", "Resource": "*" },
    { "Effect": "Allow", "Action": "iam:PassRole", "Resource": "*" },
    { "Effect": "Allow", "Action": "sts:GetCallerIdentity", "Resource": "*" },
    { "Effect": "Allow", "Action": "ssm:GetParameter", "Resource": "*" },
    { "Effect": "Allow", "Action": "s3:*", "Resource": "*" }
  ]
}
```

#### Option B: Tighter (stack + bootstrap scoped)

Replace `<ACCOUNT_ID>` and `<REGION>`. This example assumes stack name `RollModelStack` and default CDK bootstrap qualifier (`hnb659fds`).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:GetTemplate",
        "cloudformation:ListStackResources",
        "cloudformation:UpdateStack",
        "cloudformation:CreateStack",
        "cloudformation:DeleteStack"
      ],
      "Resource": [
        "arn:aws:cloudformation:<REGION>:<ACCOUNT_ID>:stack/RollModelStack/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:ListTags",
        "lambda:TagResource",
        "lambda:UntagResource"
      ],
      "Resource": "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:RollModelStack-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:POST",
        "apigateway:PUT",
        "apigateway:PATCH",
        "apigateway:DELETE"
      ],
      "Resource": "arn:aws:apigateway:<REGION>::/restapis*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:UpdateTable",
        "dynamodb:DeleteTable",
        "dynamodb:DescribeTable",
        "dynamodb:TagResource",
        "dynamodb:UntagResource"
      ],
      "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/RollModel"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:CreateUserPool",
        "cognito-idp:UpdateUserPool",
        "cognito-idp:DeleteUserPool",
        "cognito-idp:CreateUserPoolClient",
        "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:DeleteUserPoolClient",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:DescribeUserPoolClient"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:<REGION>:<ACCOUNT_ID>:parameter/roll-model/openai_api_key"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cdk-hnb659fds-assets-<ACCOUNT_ID>-<REGION>",
        "arn:aws:s3:::cdk-hnb659fds-assets-<ACCOUNT_ID>-<REGION>/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-deploy-role-<ACCOUNT_ID>-<REGION>",
        "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-file-publishing-role-<ACCOUNT_ID>-<REGION>"
      ]
    }
  ]
}
```

## Configuration Notes

- OpenAI API key must exist in SSM at `/roll-model/openai_api_key`.
- Signup request Lambda expects:
  - `SIGNUP_APPROVAL_EMAIL`
  - `SIGNUP_SOURCE_EMAIL`
- Feedback Lambda expects:
  - `GITHUB_TOKEN_SSM_PARAM` (default: `/roll-model/github_token`)
  - `GITHUB_REPO` (format: `owner/repo`)
- Store the GitHub token in SSM Parameter Store (SecureString), for example:
  - `/roll-model/github_token`
- Local/test fallback: `GITHUB_TOKEN` env var is still supported when present.

## Observability

- Lambda handlers emit structured JSON logs for `request.start`, `request.success`, and `request.error`.
- Standard log fields include correlation identifiers and request context (for example: `requestId`, `lambdaRequestId`, `correlationId`, `traceId`, `route`, `method`, `statusCode`, `latencyMs`).
- When Cognito claims are present, logs also include `userId`, `userRole`, and `userRoles`.
- AWS X-Ray tracing is enabled for the API Gateway stage and all backend Lambda functions to support request debugging across hops.
- CloudWatch metric filters derive aggregate backend metrics from structured Lambda logs:
  - `RollModel/Backend :: StructuredRequestErrors`
  - `RollModel/Backend :: StructuredRequestLatencyMs`
- A CloudWatch dashboard (`<stack-name>-Operations`) is provisioned with API Gateway, Lambda, and structured-log observability widgets.
- Default alarms are provisioned (no notification actions attached by default):
  - structured request errors >= `5` in `5` minutes
  - structured request latency p95 >= `3000ms` for `10` minutes (2x5m periods)

## AI Integration

- OpenAI calls are server-side only (`backend/lambdas/aiChat/index.ts`).
- Key location in SSM Parameter Store:
  - `/roll-model/openai_api_key`
- AI response shape includes:
  - `assistant_text`
  - `extracted_updates`
  - `suggested_prompts`
- Context retrieval combines:
  - recent entries (default 10),
  - recent thread messages (default 20),
  - optional keyword-based retrieval with privacy scope enforcement.

### OpenAI Tweak Points (Developer Reference)

Search for markers:

```bash
rg -n "OPENAI_TWEAK_POINT" backend
```

Current markers and what they control:

- `backend/shared/openai.ts`
  - OpenAI HTTP request transport and payload (endpoint, headers, model, request body).
  - OpenAI response parsing and validation.
- `backend/lambdas/aiChat/index.ts`
  - Prompt context serialization (`buildPromptContext`) for what app data is sent.
  - System prompt (`buildSystemPrompt`) for behavior and output contract.
  - Message assembly at `callOpenAI(...)` (history formatting and user payload).

These markers are intended as stable search anchors even if exact line numbers move.

## Data Export

Athletes can export data via `GET /export`.

- Query option:
  - `mode=full`
  - `mode=tidy`
  - no `mode` returns both.
- Response includes:
  - `schemaVersion`
  - `generatedAt`
  - full and/or tidy datasets for entries, comments, links, AI threads, and AI messages.
- Designed for downstream analysis in Python, Pandas, notebooks, and ML experimentation.

## Security and Privacy

- Role enforcement uses Cognito claim `custom:role` (`athlete` or `coach`).
- Coaches can only access linked athletes.
- Coaches receive `shared` entry content only.
- AI context respects privacy scope and never exposes athlete private notes to coaches.
- OpenAI calls run server-side only.

## Future Work (Planned)

### Near-term

- Complete and publish API contract updates for all routes (including `DELETE /links/coach`, feedback, and signup endpoints).
- Add frontend support for richer AI context controls (date range, entry selection, keyword filters).
- Improve analytics beyond baseline charts (time windows, trend summaries, coach-visible shared metrics).
- Expand automated test coverage for cross-role and privacy edge cases.

### Mid-term

- Introduce controlled technique vocabulary and alias mapping pipeline.
- Add weekly/monthly training reports generated from export/tidy models.
- Add optional athlete-consented anonymized cohort analytics.
- Improve operational observability (structured logging, alarms, failure dashboards).

### Longer-term

- ML-assisted pattern detection for workload/recovery signals.
- Experimentation framework for prompt/retrieval strategies with measurable quality metrics.
