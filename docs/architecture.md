# Roll Model Architecture

## AWS components
- **API Gateway (REST API)**: `RollModelApi` with `prod` stage. Routes terminate here and use Cognito authorizer.
- **Cognito User Pool**: `RollModelUserPool` with email sign-in + `custom:role` attribute (`athlete` or `coach`).
- **Cognito User Pool Client**: `RollModelUserPoolClient` for SRP/password auth flows.
- **Lambda functions** (Node.js 20): `createEntry`, `getEntries`, `postComment`, `linkCoachAthlete`, `exportData`, `aiChat`.
- **DynamoDB**: `RollModel` single-table design (PK/SK). On-demand billing with PITR enabled and RETAIN removal policy.
- **SSM Parameter Store**: `/roll-model/openai_api_key` read by the `aiChat` Lambda.
- **IAM**: API Gateway invokes Lambdas. Lambdas have read/write access to DynamoDB. `aiChat` has `ssm:GetParameter` for the OpenAI key.

## Stack outputs (deployed)
These are emitted as CloudFormation outputs on deploy and should be treated as the source of truth for runtime configuration.
- `ApiUrl`
- `UserPoolId`
- `UserPoolClientId`
- `TableName`

## Fetching stack outputs
Use CloudFormation outputs from the deployed stack to wire clients and tooling. Example (replace stack name): 
```bash
aws cloudformation describe-stacks \
  --stack-name RollModelStack \
  --query "Stacks[0].Outputs"
```

## Security boundaries
- **Auth boundary**: API Gateway requires Cognito JWTs for all routes. Lambdas enforce role checks (`athlete` vs `coach`) and reject missing/invalid claims.
- **Data boundary**: DynamoDB partitions data by athlete and entry. Coach access is granted only if an explicit coach link exists for that athlete.
- **Privacy boundary**: Entries have `private` and `shared` sections. Coaches only receive `shared` content.
- **AI boundary**: Coaches are forced to shared-only context even if they request private data. Keyword indexes store private tokens under a separate `USER_PRIVATE#{athleteId}` partition.
- **Secrets boundary**: OpenAI API key is stored in SSM and only the `aiChat` Lambda can read it.

## Request flow
1. Client authenticates with Cognito and receives a JWT containing `sub` and `custom:role`.
2. Client calls API Gateway with the JWT.
3. Cognito authorizer validates the token and injects claims into `requestContext`.
4. The target Lambda validates role and input, then reads/writes DynamoDB.
5. Response is returned as JSON from the Lambda through API Gateway.

### AI request flow (`POST /ai/chat`)
1. Client calls API Gateway with a JWT and request payload.
2. `aiChat` validates role, coach linkage, and privacy rules.
3. `aiChat` reads recent entries, keyword-index matches, and thread messages from DynamoDB.
4. `aiChat` fetches the OpenAI key from SSM, calls OpenAI, then stores the new messages.
5. `aiChat` responds with the assistant text and extracted updates.
