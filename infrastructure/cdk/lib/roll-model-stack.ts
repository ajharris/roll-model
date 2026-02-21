import * as fs from 'fs';
import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

export class RollModelStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'RollModelTable', {
      tableName: 'RollModel',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const userPool = new cognito.UserPool(this, 'RollModelUserPool', {
      selfSignUpEnabled: true,
      signInAliases: {
        email: true
      },
      autoVerify: {
        email: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false
        }
      },
      customAttributes: {
        role: new cognito.StringAttribute({
          minLen: 5,
          maxLen: 7,
          mutable: true
        })
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      }
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'RollModelUserPoolClient', {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true
      }
    });

    const createEntryLambda = this.createLambda('createEntry', 'backend/lambdas/createEntry/index.ts', table);
    const getEntriesLambda = this.createLambda('getEntries', 'backend/lambdas/getEntries/index.ts', table);
    const postCommentLambda = this.createLambda('postComment', 'backend/lambdas/postComment/index.ts', table);
    const linkCoachAthleteLambda = this.createLambda(
      'linkCoachAthlete',
      'backend/lambdas/linkCoachAthlete/index.ts',
      table
    );
    const revokeCoachLinkLambda = this.createLambda(
      'revokeCoachLink',
      'backend/lambdas/revokeCoachLink/index.ts',
      table
    );
    const exportDataLambda = this.createLambda('exportData', 'backend/lambdas/exportData/index.ts', table);
    const aiChatLambda = this.createLambda('aiChat', 'backend/lambdas/aiChat/index.ts', table);

    aiChatLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/roll-model/openai_api_key`
        ]
      })
    );

    const api = new apigateway.RestApi(this, 'RollModelApi', {
      restApiName: 'RollModelApi',
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://main.d15hzi11jeckui.amplifyapp.com'],
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod'
      }
    });
    api.addGatewayResponse('Default4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'https://main.d15hzi11jeckui.amplifyapp.com'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,DELETE,OPTIONS'",
      },
    });

    api.addGatewayResponse('GatewayResponseDefault4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Authorization-Bearer'",
        'Access-Control-Allow-Methods': "'GET,POST,DELETE,OPTIONS'"
      }
    });

    api.addGatewayResponse('GatewayResponseDefault5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Authorization-Bearer'",
        'Access-Control-Allow-Methods': "'GET,POST,DELETE,OPTIONS'"
      }
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'RollModelAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'RollModelCognitoAuthorizer'
    });

    const methodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer
    };

    const entries = api.root.addResource('entries');
    entries.addMethod('POST', new apigateway.LambdaIntegration(createEntryLambda), methodOptions);
    entries.addMethod('GET', new apigateway.LambdaIntegration(getEntriesLambda), methodOptions);
    entries.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Authorization-Bearer']
    });

    const comments = entries.addResource('comments');
    comments.addMethod('POST', new apigateway.LambdaIntegration(postCommentLambda), methodOptions);
    comments.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Authorization-Bearer']
    });

    const entryById = entries.addResource('{entryId}');
    const entryComments = entryById.addResource('comments');
    entryComments.addMethod('POST', new apigateway.LambdaIntegration(postCommentLambda), methodOptions);
    entryComments.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Authorization-Bearer']
    });

    const links = api.root.addResource('links');
    const athleteCoach = links.addResource('coach');
    athleteCoach.addMethod('POST', new apigateway.LambdaIntegration(linkCoachAthleteLambda), methodOptions);
    athleteCoach.addMethod('DELETE', new apigateway.LambdaIntegration(revokeCoachLinkLambda), methodOptions);
    athleteCoach.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Authorization-Bearer']
    });

    const exportResource = api.root.addResource('export');
    exportResource.addMethod('GET', new apigateway.LambdaIntegration(exportDataLambda), methodOptions);
    exportResource.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Authorization-Bearer']
    });

    const ai = api.root.addResource('ai');
    const aiChat = ai.addResource('chat');
    aiChat.addMethod('POST', new apigateway.LambdaIntegration(aiChatLambda), methodOptions);
    aiChat.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Authorization-Bearer']
    });

    const athletes = api.root.addResource('athletes');
    const athleteById = athletes.addResource('{athleteId}');
    const athleteEntries = athleteById.addResource('entries');
    athleteEntries.addMethod('GET', new apigateway.LambdaIntegration(getEntriesLambda), methodOptions);
    athleteEntries.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Authorization-Bearer']
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName
    });
  }

  private createLambda(name: string, entryPath: string, table: dynamodb.Table): nodejs.NodejsFunction {
    const entry = path.join(__dirname, '..', '..', '..', entryPath);
    const resolvedEntry = fs.existsSync(entry) ? entry : entry.replace(/\.ts$/, '.js');
    const fn = new nodejs.NodejsFunction(this, `${name}Lambda`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: resolvedEntry,
      environment: {
        TABLE_NAME: table.tableName
      },
      bundling: {
        target: 'node20',
        minify: true,
        sourceMap: false
      }
    });

    table.grantReadWriteData(fn);
    return fn;
  }
}
