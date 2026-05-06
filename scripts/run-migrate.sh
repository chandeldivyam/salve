#!/usr/bin/env bash
# Trigger the Drizzle migrate task against a stage's Aurora cluster.
#
# Usage:
#   STAGE=prod bash scripts/run-migrate.sh
#
# Reads sst outputs to find the cluster, task definition, and VPC subnets.
# Runs the task, polls until completion, prints exit code + log link.

set -euo pipefail
STAGE="${STAGE:-prod}"
REGION="${AWS_REGION:-us-east-1}"

echo "Looking up stage outputs for $STAGE..."
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Pull resource references via aws CLI lookups (SST 4.x doesn't expose outputs
# via `sst output`). Cluster: filter by tag. Task: latest revision of the
# Migrate family in that cluster.
CLUSTER_ARN=$(AWS_REGION="$REGION" aws ecs list-clusters --query "clusterArns[?contains(@, 'salve-${STAGE}')]|[0]" --output text)
TASK_DEF=$(AWS_REGION="$REGION" aws ecs list-task-definitions --status ACTIVE --query "taskDefinitionArns[?contains(@, 'salve-${STAGE}-') && contains(@, 'Migrate')]|[-1]" --output text)

if [ -z "$TASK_DEF" ] || [ -z "$CLUSTER_ARN" ]; then
  echo "Could not resolve task def or cluster. Outputs: $TASK_DEF / $CLUSTER_ARN" >&2
  exit 1
fi

echo "Cluster:        $CLUSTER_ARN"
echo "Task def:       $TASK_DEF"

# Find the VPC + private subnets. The migrate task needs to reach Aurora,
# which lives in the same VPC's private subnets.
VPC_ID=$(AWS_REGION="$REGION" aws ec2 describe-vpcs --filters "Name=tag:sst:app,Values=salve" "Name=tag:sst:stage,Values=$STAGE" --query "Vpcs[0].VpcId" --output text)
SUBNETS=$(AWS_REGION="$REGION" aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*PrivateSubnet*" --query "Subnets[*].SubnetId" --output text | tr '\t' ',')
# Use the cluster's default security group (Aurora's SG accepts traffic from
# inside the VPC, so any SG within the VPC works).
SG_ID=$(AWS_REGION="$REGION" aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=default" --query "SecurityGroups[0].GroupId" --output text)

echo "VPC:            $VPC_ID"
echo "Private subnets: $SUBNETS"
echo "Security group: $SG_ID"

NETWORK_CONFIG="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG_ID],assignPublicIp=DISABLED}"

echo "Starting migrate task..."

# Allow opt-in destructive reset (drops public + zero schemas before applying
# all migrations). Usage:
#   RESET_SCHEMA=1 STAGE=prod bash scripts/run-migrate.sh
RESET_SCHEMA="${RESET_SCHEMA:-0}"
RUN_TASK_ARGS=(
  --cluster "$CLUSTER_ARN"
  --launch-type FARGATE
  --task-definition "$TASK_DEF"
  --network-configuration "$NETWORK_CONFIG"
)
if [ "$RESET_SCHEMA" = "1" ]; then
  echo "RESET_SCHEMA=1 — destructive reset enabled."
  RUN_TASK_ARGS+=(
    --overrides "$(printf '{"containerOverrides":[{"name":"Migrate","environment":[{"name":"RESET_SCHEMA","value":"1"}]}]}')"
  )
fi
TASK_ARN=$(AWS_REGION="$REGION" aws ecs run-task "${RUN_TASK_ARGS[@]}" --query "tasks[0].taskArn" --output text)

echo "Task ARN: $TASK_ARN"
echo "Polling for completion..."
until [ "$(AWS_REGION="$REGION" aws ecs describe-tasks --cluster "$CLUSTER_ARN" --tasks "$TASK_ARN" --query 'tasks[0].lastStatus' --output text)" = "STOPPED" ]; do
  sleep 10
done

EXIT_CODE=$(AWS_REGION="$REGION" aws ecs describe-tasks --cluster "$CLUSTER_ARN" --tasks "$TASK_ARN" --query "tasks[0].containers[0].exitCode" --output text)
STOPPED_REASON=$(AWS_REGION="$REGION" aws ecs describe-tasks --cluster "$CLUSTER_ARN" --tasks "$TASK_ARN" --query "tasks[0].stoppedReason" --output text)

echo "Exit code:      $EXIT_CODE"
echo "Stopped reason: $STOPPED_REASON"

if [ "$EXIT_CODE" != "0" ]; then
  echo "Migration FAILED. Tail of logs:"
  TASK_ID=$(echo "$TASK_ARN" | rev | cut -d/ -f1 | rev)
  LOGS=$(AWS_REGION="$REGION" aws logs describe-log-groups --log-group-name-prefix /sst --query "logGroups[?contains(logGroupName, 'Migrate')].logGroupName" --output text)
  AWS_REGION="$REGION" aws logs tail "$LOGS" --since 10m --format short | tail -40
  exit 1
fi

echo "Migration succeeded."
