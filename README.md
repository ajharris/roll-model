# roll-model backend

Production-grade serverless backend for the **roll-model** scientific training intelligence platform for grapplers.

## Project overview

Core principles:
- Athlete owns their training and AI conversation data.
- Coaches can comment and access shared context only for linked athletes.
- Structured data-first architecture for analytics and ML.
- JSON exports from day one.

## Architecture summary

- AWS CDK v2 (TypeScript)
- API Gateway REST API + Cognito JWT authorizer
- Lambda (Node.js 20)
- DynamoDB single-table (`RollModel`)
- OpenAI server-side integration for `/ai/chat`
- Keyword-based context retrieval for `/ai/chat` with DynamoDB keyword index
- OpenAI key sourced from SSM SecureString: `/roll-model/openai_api_key`

## Environment setup

1. Install Node.js 20+
2. Install dependencies
   ```bash
   npm install
   ```
3. Build
   ```bash
   npm run build
   ```
4. Test
   ```bash
   npm test
   ```
5. Lint
   ```bash
   npm run lint
   ```

## Deploy with CDK

```bash
npm run cdk:deploy
```

Before deployment, set OpenAI key in SSM:

```bash
aws ssm put-parameter \
  --name /roll-model/openai_api_key \
  --type SecureString \
  --overwrite \
  --value "<OPENAI_API_KEY>"
```

## Docs

- `docs/data-model.md`
- `docs/api-contracts.md`
