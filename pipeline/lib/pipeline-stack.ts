import { RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { BuildSpec, Cache, LinuxBuildImage, LocalCacheMode, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline,  } from 'aws-cdk-lib/aws-codepipeline';
import * as pipelines from '@aws-cdk/pipelines';
import { CodeBuildAction, GitHubSourceAction, S3DeployAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { CompositePrincipal, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface PipelineStackProps extends StackProps {
  envName: string;
  infrastructureRepoName: string;
  infrastructureBranchName: string;
  repositoryOwner: string;
  deployRegions: string[];
}

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    console.log(props)
    const { 
      envName,
      infrastructureRepoName,
      infrastructureBranchName,
      repositoryOwner,
      deployRegions,
    } = props;

    const gitHubToken = SecretValue.secretsManager('github-token', { jsonField: 'github-token' });

    // CodeBuild stage must be able to assume the cdk deploy roles created when bootstrapping the account
    // The role itself must also be assumable by the pipeline in which the stage resides
    const infrastructureDeployRole = new Role(
      this,
      'InfrastructureDeployRole',
      {
        assumedBy: new CompositePrincipal(
          new ServicePrincipal('codebuild.amazonaws.com'),
          new ServicePrincipal('codepipeline.amazonaws.com')
        ),
        inlinePolicies: {
          CdkDeployPermissions: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: ['sts:AssumeRole'],
                resources: ['arn:aws:iam::*:role/cdk-*'],
              }),
            ],
          })    
        }
      }
    )

    const artifactBucket = new Bucket(
      this,
      'ArtifactBucket',
      {
        bucketName:`your-${envName}-codepipeline-artifact-bucket`,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      }
    );

    
    const infrastructureSourceOutput = new Artifact('InfrastructureSourceOutput');

    const regionalCodeBuildProjects: CodeBuildAction[] = [];

  for (const region of deployRegions) {
    // create a project per region or reuse if possible
    const project = new PipelineProject(this, `InfrastructureBuildProject-${region}`, {
      role: infrastructureDeployRole,
      environment: { buildImage: LinuxBuildImage.AMAZON_LINUX_2_5 },
      environmentVariables: {
        DEPLOY_ENVIRONMENT: { value: envName },
        REGION: { value: region },
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: '20.x' },
            commands: [
              'npm install -g aws-cdk',
              'cd infrastructure',
              'npm install'
            ]
          },
          build: {
          commands: [
            'cdk deploy --context env=$DEPLOY_ENVIRONMENT --require-approval never --region $REGION'
          ]
          }
        }
      }),
    });

    regionalCodeBuildProjects.push(
      new CodeBuildAction({
        actionName: `DeployCdkInfrastructure-${region}`,
        project,
        input: infrastructureSourceOutput,
        role: infrastructureDeployRole,
      })
    );
  }


    // Build project for infrastructure (CDK)
//     const infrastructureBuildProject = new PipelineProject(
//       this,
//       'InfrastructureBuildProject',
//       {
//         role: infrastructureDeployRole,
//         environment: {
//           buildImage: LinuxBuildImage.AMAZON_LINUX_2_5
//         },
//         environmentVariables: {
//           DEPLOY_ENVIRONMENT: {
//             value: envName
//           },
//           DEPLOY_REGIONS: { value: deployRegions }
//         },
//         buildSpec: BuildSpec.fromObject({
//           version: '0.2',
//           phases: {
//             install: {
//               'runtime-versions': {
//                 nodejs: '20.x'
//               },
//               commands: [
//                 'npm install -g aws-cdk',
//                 'cd infrastructure',
//                 'npm install'
//               ]
//             },
//             build: {
//               commands: [
//                 `
//                   for REGION in $DEPLOY_REGIONS; do
//                     cdk deploy --context env=$DEPLOY_ENVIRONMENT --region $REGION
//                   done
//                 `
//               ]
//             }
//           }
//         }),
//       }
//     );

    // Define the CodePipeline
    const pipeline = new Pipeline(
      this,
      'CIPipeline', 
      {
        pipelineName: `${envName}-CI-Pipeline`,
        role: infrastructureDeployRole,
        artifactBucket
      }
    );

    // Source Infrastructure stage
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new GitHubSourceAction({
          owner: repositoryOwner,
          repo: infrastructureRepoName,
          actionName: 'InfrastructureSource',
          branch: infrastructureBranchName,
          output: infrastructureSourceOutput,
          oauthToken: gitHubToken
        }),
      ],
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: regionalCodeBuildProjects, // multiple actions == parallel execution
    });


    // // Deploy the CDK infrastructure
    // pipeline.addStage({
    //   stageName: 'Deploy',
    //   actions: [
    //     new CodeBuildAction({
    //       actionName: 'DeployCdkInfrastructure',
    //       project: infrastructureBuildProject,
    //       input: infrastructureSourceOutput,
    //       role: infrastructureDeployRole
    //     }),
    //   ],
    // });

  }
}
