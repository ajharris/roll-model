import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { RollModelStack } from './roll-model-stack';

describe('RollModelStack CORS', () => {
  it('uses Authorization-only headers in API Gateway error responses and preflight methods', () => {
    const app = new cdk.App();
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
