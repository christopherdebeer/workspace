import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceEc2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================================
    // VPC — use default VPC (Tailscale handles connectivity)
    // ========================================================
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // ========================================================
    // Security Group — zero inbound, Tailscale only
    // ========================================================
    const sg = new ec2.SecurityGroup(this, 'WorkspaceSg', {
      vpc,
      description: 'Claude Code workspace - no inbound, Tailscale only',
      allowAllOutbound: true,
    });

    // ========================================================
    // IAM Role — SSM access + Parameter Store read
    // ========================================================
    const role = new iam.Role(this, 'WorkspaceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    role.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/workspace/*`,
      ],
    }));

    // ========================================================
    // EC2 Instance — Ubuntu 24.04 LTS, t3.medium
    // ========================================================
    const instance = new ec2.Instance(this, 'Workspace', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.lookup({
        name: 'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*',
        owners: ['099720109477'], // Canonical
      }),
      securityGroup: sg,
      role,
      associatePublicIpAddress: true,
      blockDevices: [{
        deviceName: '/dev/sda1',
        volume: ec2.BlockDeviceVolume.ebs(30, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          encrypted: true,
        }),
      }],
    });

    // ========================================================
    // Data Volume — 100GB gp3, survives termination
    // ========================================================
    const dataVolume = new ec2.Volume(this, 'DataVolume', {
      availabilityZone: instance.instanceAvailabilityZone,
      size: cdk.Size.gibibytes(100),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
      instanceId: instance.instanceId,
      volumeId: dataVolume.volumeId,
      device: '/dev/xvdf',
    });

    // ========================================================
    // UserData — first-boot provisioning script
    // ========================================================
    const userDataScript = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'user-data.sh'),
      'utf8',
    );
    instance.addUserData(userDataScript);

    // ========================================================
    // Outputs
    // ========================================================
    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
    });
    new cdk.CfnOutput(this, 'AvailabilityZone', {
      value: instance.instanceAvailabilityZone,
    });
    new cdk.CfnOutput(this, 'SecurityGroupId', {
      value: sg.securityGroupId,
    });
    new cdk.CfnOutput(this, 'RoleArn', {
      value: role.roleArn,
    });
    new cdk.CfnOutput(this, 'DataVolumeId', {
      value: dataVolume.volumeId,
    });
  }
}
