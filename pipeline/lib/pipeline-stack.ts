import { RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Distribution, OriginAccessIdentity, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BuildSpec, Cache, LinuxBuildImage, LocalCacheMode, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, GitHubSourceAction, S3DeployAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { CompositePrincipal, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface PipelineStackProps extends StackProps {
  envName: string;
  frontendRepoName: string;
  frontendBranchName: string;
  infrastructureRepoName: string;
  infrastructureBranchName: string;
  repositoryOwner: string;
  subdomain: string;
  domain: string;
}

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    console.log(props)
    const { 
      envName,
      //frontendRepoName,
      //frontendBranchName,
      infrastructureRepoName,
      infrastructureBranchName,
      repositoryOwner,
      subdomain,
      domain,
    } = props;

    const gitHubToken = SecretValue.secretsManager('github-token');

    // :::::::::: AWS::IAM::Roles & Policies ::::::::::
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

    // :::::::::: AWS::S3::Bucket ::::::::::
    // This is the bucket that will house the web application and will serve as the origin for CloudFront
    // const frontendBucket = new Bucket(
    //   this,
    //   "FrontendSourceBucket",
    //   {
    //     bucketName: `your-${envName}-frontend-source-bucket`,
    //     removalPolicy: RemovalPolicy.DESTROY,
    //     autoDeleteObjects: true,
    //   }
    // );
    const artifactBucket = new Bucket(
      this,
      'ArtifactBucket',
      {
        bucketName:`your-${envName}-codepipeline-artifact-bucket`,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      }
    );

    // // :::::::::: AWS::Route53 ::::::::::
    // // Define the domain name and hosted zone
    // const domainName = `${subdomain}${domain}`;
    // const hostedZone = new HostedZone(
    //   this,
    //   'HostedZone',
    //   {
    //      zoneName: domainName,
    //   }
    // );

    // const certificate = new Certificate(
    //   this, 
    //   'SSLCertificate', 
    //   {
    //     domainName: domainName,
    //     validation: CertificateValidation.fromDns(hostedZone),
    //   }
    // );
    
    // const originAccessIdentity = new OriginAccessIdentity(this, 'OriginAccessIdentity');
    // frontendBucket.grantRead(originAccessIdentity);
    
    // // :::::::::: AWS::CloudFront::Distribution ::::::::::
    // const distribution = new Distribution(
    //   this,
    //   'FrontendDistribution',
    //   {
    //     defaultRootObject: 'index.html',
    //     defaultBehavior: {
    //       origin: new S3Origin(
    //         frontendBucket,
    //         {
    //           originAccessIdentity
    //         }
    //       ),
    //       viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    //     },
    //     domainNames: [domainName],
    //     certificate,
    //   },
    // );

    // const aRecord = new ARecord(
    //   this,
    //   'AliasRecord',
    //   {
    //     zone: hostedZone,
    //     target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    //   }
    // );
    
    // :::::::::: AWS::Code::Pipeline ::::::::::
    // Source artifacts
    const frontendSourceOutput = new Artifact('FrontendSourceOutput');
    const infrastructureSourceOutput = new Artifact('InfrastructureSourceOutput');

    // Build project for infrastructure (CDK)
    const infrastructureBuildProject = new PipelineProject(
      this,
      'InfrastructureBuildProject',
      {
        role: infrastructureDeployRole,
        environment: {
          buildImage: LinuxBuildImage.AMAZON_LINUX_2_5
        },
        environmentVariables: {
          DEPLOY_ENVIRONMENT: {
            value: envName
          }
        },
        buildSpec: BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              'runtime-versions': {
                nodejs: '20.x'
              },
              commands: [
                'npm install -g aws-cdk',
                'cd infrastructure',
                'npm install'
              ]
            },
            build: {
              commands: [
                `cdk deploy --context env=${envName}`
              ]
            }
          }
        }),
      }
    );

    // Build project for frontend (Vue.js)
    // const frontendBuildProject = new PipelineProject(
    //   this,
    //   'FrontendBuildProject',
    //   {
    //     environment: {
    //       buildImage: LinuxBuildImage.AMAZON_LINUX_2_5,
    //     },
    //     buildSpec: BuildSpec.fromObject({
    //       version: '0.2',
    //       phases: {
    //         install: {
    //           'runtime-versions': {
    //             nodejs: '20.x'
    //           },
    //         },
    //         pre_build: {
    //           commands: [
    //             'npm install',
    //           ]
    //         },
    //         build: {
    //           commands: [
    //             'echo Building Frontend...',
    //             'npm run build',
    //           ]
    //         },
    //       },
    //       artifacts: {
    //         'base-directory': 'dist',
    //         files: '**/*',
    //       },
    //       cache: {
    //         paths: [
    //           'node_modules/**/*',
    //         ],
    //       },
    //     }),
    //     cache: Cache.local(LocalCacheMode.CUSTOM),
    //   }
    // );

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

    // Source FE + Infrastructure stage
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        // new GitHubSourceAction({
        //   owner: repositoryOwner,
        //   repo: frontendRepoName,
        //   actionName: 'FrontendSource',
        //   branch: frontendBranchName,
        //   output: frontendSourceOutput,
        //   oauthToken: gitHubToken
        // }),
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

    // Build frontend app
    // const frontendBuildOutput = new Artifact('FrontendBuildOutput');
    // pipeline.addStage({
    //   stageName: 'Build',
    //   actions: [
    //     new CodeBuildAction({
    //       actionName: 'BuildFrontend',
    //       project: frontendBuildProject,
    //       input: frontendSourceOutput,
    //       outputs: [frontendBuildOutput],
    //     }),
    //   ],
    // });

    // Deploy frontend to S3 and deploy the CDK infrastructure
    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        // new S3DeployAction({
        //   actionName: 'DeployFrontend',
        //   bucket: frontendBucket,
        //   input: frontendBuildOutput,
        //   extract: true
        // }),
        new CodeBuildAction({
          actionName: 'DeployCdkInfrastructure',
          project: infrastructureBuildProject,
          input: infrastructureSourceOutput,
          role: infrastructureDeployRole
        }),
      ],
    });
  }
}
