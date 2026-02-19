# BJJ Lab Notebook (Roll Model)

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

## CI/CD (GitHub Actions + Amplify)

This repo uses:

-   **GitHub Actions** to build, test, and deploy the backend (CDK).
-   **AWS Amplify** to build and deploy the frontend.

### GitHub Actions

Workflows:

-   `/.github/workflows/ci.yml` runs lint/test/build on PRs and `main`.
-   `/.github/workflows/deploy-backend.yml` deploys CDK on pushes to `main`.

Required GitHub repo variables:

-   `AWS_REGION=us-east-1`
-   `AWS_ROLE_ARN=arn:aws:iam::<account-id>:role/<github-actions-role-name>`

### Amplify

Amplify uses `amplify.yml` at repo root and the env vars in the console.
Set the frontend `NEXT_PUBLIC_*` variables in Amplify (not GitHub secrets).

### GitHub OIDC Role (Recommended)

Create an IAM role for GitHub OIDC and trust only `main` on this repo:

``` json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::864981757594:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/main" }
      }
    }
  ]
}
```

### IAM Permissions (Two Options)

Option A: **Baseline (broad, easiest)**

``` json
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
    { "Effect": "Allow", "Action": "ssm:GetParameter", "Resource": "*" }
  ]
}
```

Option B: **Tighter (scoped to this stack + CDK bootstrap)**

Replace `<ACCOUNT_ID>` and `<REGION>` and keep stack name `RollModelStack`.
If you use a different CDK bootstrap qualifier, update the role/bucket names.

``` json
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

If CDK deploy fails with access denied, expand actions/resources incrementally.

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
