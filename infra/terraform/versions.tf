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

  # Remote state (2026-09, security/Terraform-standards audit): local state
  # with no locking was the one point where this stack didn't follow the
  # standards every other Terraform stack in these repos does. Bucket
  # created out-of-band (versioned + encrypted + public-access-blocked,
  # same as job-scraper's own bucket, since a backend can't bootstrap the
  # storage it depends on) and state migrated via
  # `terraform init -migrate-state`.
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
