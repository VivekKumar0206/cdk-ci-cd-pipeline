import { App } from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new App();
if (!process.env.DEPLOY_ENVIRONMENT) throw new Error("DEPLOY_ENVIRONMENT is not defined.")
const { DEPLOY_ENVIRONMENT } = process.env;
const deployRegions = app.node.tryGetContext('deployRegions') as string[];

for (const region of deployRegions){
new InfrastructureStack(
  app,
  `${DEPLOY_ENVIRONMENT}-Infrastructure-Stack-${region}`, 
  {
    DEPLOY_ENVIRONMENT,
    env:{region},
    description: `Stack for the ${DEPLOY_ENVIRONMENT} infrastructure deployed using the CI pipeline. If you need to delete everything involving the ${DEPLOY_ENVIRONMENT} environment, delete this stack first, then the CI stack.`
  }
);
}