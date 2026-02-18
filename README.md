# roll-model backend

Production-grade serverless backend for the **roll-model** scientific training intelligence platform for grapplers.

## Project overview

This repository initializes the backend foundation with strict TypeScript, AWS CDK v2 infrastructure, and modular Lambda handlers.

Core principles implemented:
- Athlete owns their training data.
- Coaches can comment but cannot alter or delete athlete entries.
- Structured-first storage for analytics and ML-readiness.
- JSON export available from day one.

## Architecture summary

- **AWS CDK v2 (TypeScript)** provisions all cloud resources.
- **API Gateway REST API** for HTTP interface.
- **Cognito User Pool** for JWT auth (`custom:role` claim for `athlete | coach`).
- **Lambda (Node.js 20)** for business logic.
- **DynamoDB single-table (`RollModel`)** for user, entry, link, and comment entities.

Repository layout:

```text
backend/
  lambdas/
  shared/
infrastructure/
  cdk/
docs/
```

## Environment setup

1. Install Node.js 20+
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build project:
   ```bash
   npm run build
   ```
4. Run tests:
   ```bash
   npm test
   ```
5. Run lint:
   ```bash
   npm run lint
   ```

## Deploy with CDK

Configure AWS credentials and default region/account, then run:

```bash
npm run cdk:deploy
```

To preview synthesized infrastructure:

```bash
npm run cdk:synth
```

## Documentation

- Data model: `docs/data-model.md`
- API contracts: `docs/api-contracts.md`
