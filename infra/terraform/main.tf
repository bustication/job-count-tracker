# job-count-tracker: one IAM role, scoped to read exactly one thing.
#
# This project's GitHub Action assumes this role (via OIDC, no long-lived AWS
# key stored anywhere) to Scan job-scraper's DynamoDB table for its
# `count#<company>` items -- nothing else. It cannot create, modify, or
# delete anything in AWS; it cannot read any other table; it cannot write to
# this one either. See ../../poller/poll.py for what it's used for and
# README.md in this directory for the manual-apply workflow.
#
# Applied by hand from a local AdministratorAccess session, same bootstrap
# pattern job-scraper's own infra/README.md describes -- this repo's own CI
# (.github/workflows/update-data.yml) never runs `terraform apply`, only ever
# assumes the role this creates.
#
# Remote state (2026-09, security/Terraform-standards audit): local state
# with no locking was the one point where this stack didn't follow the
# standards every other Terraform stack in these repos does. Bucket created
# out-of-band (versioned + encrypted + public-access-blocked, same as
# job-scraper's own bucket, since a backend can't bootstrap the storage it
# depends on) and state migrated via `terraform init -migrate-state`.

terraform {
  # >= 1.10 for the S3 backend's native `use_lockfile` locking below (no
  # DynamoDB lock table needed) -- see job-scraper's own versions.tf.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "job-count-tracker-tfstate-342609432970"
    key          = "job-count-tracker/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# job-scraper's own AWS account already has a GitHub Actions OIDC identity
# provider (created by that project's own Terraform, for its own CI role) --
# an OIDC provider is a per-account resource, one is enough for any number of
# repos/roles, so this is a `data` lookup (reuse), never a `resource`
# (this project must never be able to create/delete/manage it).
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# Read-only reference to job-scraper's table by name -- resolves the real
# ARN without hardcoding the account id, and this being a `data` source (not
# a `resource`) means this project's Terraform state can never manage,
# recreate, or delete job-scraper's table even by accident.
data "aws_dynamodb_table" "seen_jobs" {
  name = var.job_scraper_table_name
}

data "aws_iam_policy_document" "tracker_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      # See variables.tf's comment on github_owner_id/github_repo_id for why
      # this isn't the classic documented sub format.
      values = ["repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "tracker_github_actions" {
  name               = "job-count-tracker-github-actions"
  assume_role_policy = data.aws_iam_policy_document.tracker_assume.json
}

data "aws_iam_policy_document" "tracker_dynamo_read" {
  statement {
    sid = "ReadJobScraperCounts"
    # Scan only -- no GetItem/Query/PutItem/UpdateItem/DeleteItem. Company
    # discovery is via a filtered Scan (see poller/poll.py), and this role
    # has no reason to ever write to job-scraper's table.
    actions   = ["dynamodb:Scan"]
    resources = [data.aws_dynamodb_table.seen_jobs.arn]
  }
}

resource "aws_iam_role_policy" "tracker_dynamo_read" {
  name   = "job-count-tracker-dynamo-read"
  role   = aws_iam_role.tracker_github_actions.id
  policy = data.aws_iam_policy_document.tracker_dynamo_read.json
}

output "role_arn" {
  description = "Put this in .github/workflows/update-data.yml's DATA_ROLE_ARN."
  value       = aws_iam_role.tracker_github_actions.arn
}
