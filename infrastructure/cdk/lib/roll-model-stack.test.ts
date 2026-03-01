import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { RollModelStack } from './roll-model-stack';

const buildApp = () =>
  new cdk.App({
    context: {
      '@aws-cdk/core:stackResourceLimit': 700
    }
  });

describe('RollModelStack CORS', () => {
  it('uses Authorization-only headers in API Gateway error responses and preflight methods', () => {
    const app = buildApp();
    const stack = new RollModelStack(app, 'TestRollModelStack');
    const template = Template.fromStack(stack);

    const gatewayResponses = template.findResources('AWS::ApiGateway::GatewayResponse');
    expect(Object.keys(gatewayResponses)).toHaveLength(2);

    for (const resource of Object.values(gatewayResponses)) {
      const responseParameters = resource.Properties.ResponseParameters as Record<string, string>;
      expect(responseParameters['gatewayresponse.header.Access-Control-Allow-Headers']).toBe(
        "'Content-Type,Authorization'"
      );
      expect(
        responseParameters['gatewayresponse.header.Access-Control-Allow-Headers']
      ).not.toContain('X-Authorization-Bearer');
    }

    const methods = template.findResources('AWS::ApiGateway::Method');
    const optionsMethods = Object.values(methods).filter((resource) => resource.Properties.HttpMethod === 'OPTIONS');

    expect(optionsMethods.length).toBeGreaterThan(0);

    for (const resource of optionsMethods) {
      const responseParameters = resource.Properties.Integration.IntegrationResponses[0].ResponseParameters as Record<
        string,
        string
      >;

      expect(responseParameters['method.response.header.Access-Control-Allow-Headers']).toBe(
        "'Content-Type,Authorization'"
      );
      expect(responseParameters['method.response.header.Access-Control-Allow-Headers']).not.toContain(
        'X-Authorization-Bearer'
      );
      expect(responseParameters['method.response.header.Access-Control-Allow-Methods']).toContain('OPTIONS');
    }
  });
});

describe('RollModelStack observability', () => {
  it('enables tracing and provisions dashboard/alarm observability resources', () => {
    const app = buildApp();
    const stack = new RollModelStack(app, 'TestRollModelStackTracing');
    const template = Template.fromStack(stack);

    const stages = template.findResources('AWS::ApiGateway::Stage');
    expect(Object.keys(stages).length).toBeGreaterThan(0);

    for (const resource of Object.values(stages)) {
      expect(resource.Properties.TracingEnabled).toBe(true);
    }

    const lambdas = template.findResources('AWS::Lambda::Function');
    const backendLambdas = Object.values(lambdas).filter(
      (resource) => resource.Properties.Environment?.Variables?.TABLE_NAME !== undefined
    );
    expect(backendLambdas.length).toBeGreaterThan(0);

    for (const resource of backendLambdas) {
      expect(resource.Properties.TracingConfig?.Mode).toBe('Active');
    }

    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    expect(Object.keys(dashboards)).toHaveLength(1);

    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(2);

    const metricFilters = template.findResources('AWS::Logs::MetricFilter');
    expect(Object.keys(metricFilters).length).toBeGreaterThanOrEqual(24);

    const filterPatterns = Object.values(metricFilters).map((resource) => resource.Properties.FilterPattern as string);
    expect(filterPatterns.some((pattern) => pattern.includes('$.event') && pattern.includes('request.error'))).toBe(
      true
    );
    expect(filterPatterns.some((pattern) => pattern.includes('$.latencyMs'))).toBe(true);
  });
});

describe('RollModelStack saved searches API', () => {
  it('provisions saved-search CRUD methods', () => {
    const app = buildApp();
    const stack = new RollModelStack(app, 'TestRollModelStackSavedSearches');
    const template = Template.fromStack(stack);

    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'));
    const nonOptions = methods.filter((resource) => resource.Properties.HttpMethod !== 'OPTIONS');
    const verbs = nonOptions.map((resource) => resource.Properties.HttpMethod as string);

    expect(verbs.filter((verb) => verb === 'GET').length).toBeGreaterThanOrEqual(1);
    expect(verbs.filter((verb) => verb === 'POST').length).toBeGreaterThanOrEqual(1);
    expect(verbs.filter((verb) => verb === 'PUT').length).toBeGreaterThanOrEqual(1);
    expect(verbs.filter((verb) => verb === 'DELETE').length).toBeGreaterThanOrEqual(1);

    const resources = template.findResources('AWS::ApiGateway::Resource');
    const pathParts = Object.values(resources).map((resource) => resource.Properties.PathPart as string);
    expect(pathParts).toContain('saved-searches');
    expect(pathParts).toContain('{savedSearchId}');
  });
});

describe('RollModelStack curriculum API', () => {
  it('provisions curriculum resources and secondary index support', () => {
    const app = buildApp();
    const stack = new RollModelStack(app, 'TestRollModelStackCurriculum');
    const template = Template.fromStack(stack);

    const tables = template.findResources('AWS::DynamoDB::Table');
    expect(Object.keys(tables)).toHaveLength(1);
    const table = Object.values(tables)[0];
    const gsis = table.Properties.GlobalSecondaryIndexes as Array<{ IndexName: string }>;
    expect(gsis.some((gsi) => gsi.IndexName === 'GSI1')).toBe(true);

    const resources = template.findResources('AWS::ApiGateway::Resource');
    const pathParts = Object.values(resources).map((resource) => resource.Properties.PathPart as string);
    expect(pathParts).toContain('curriculum');
    expect(pathParts).toContain('skills');
    expect(pathParts).toContain('relationships');
    expect(pathParts).toContain('progress');
    expect(pathParts).toContain('recompute');
    expect(pathParts).toContain('recommendations');
  });
});
