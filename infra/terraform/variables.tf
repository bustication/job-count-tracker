variable "aws_region" {
  description = "AWS region job-scraper's DynamoDB table lives in."
  type        = string
  default     = "us-west-2"
}

variable "job_scraper_table_name" {
  description = "Name of job-scraper's own DynamoDB table this role gets read-only Scan access to."
  type        = string
  default     = "job-scraper-seen"
}

variable "github_owner" {
  description = "GitHub org/user that owns this repo (used to build the OIDC trust condition)."
  type        = string
  default     = "bustication"
}

variable "github_repo" {
  description = "This repo's name (used to build the OIDC trust condition)."
  type        = string
  default     = "job-count-tracker"
}

# GitHub's real OIDC `sub` claim is NOT the classic documented
# "repo:<owner>/<repo>:ref:refs/heads/<branch>" format -- it suffixes the
# owner and repo with their immutable numeric GitHub IDs (confirmed live on
# the sibling job-scraper project, see its own infra/terraform/main.tf
# comment). Derive these AFTER the repo exists:
#   gh api repos/<owner>/<repo> --jq '{owner_id: .owner.id, repo_id: .id}'
# There is no sane default -- Terraform will fail loudly if left unset,
# which is the point (never guess this value).
variable "github_owner_id" {
  description = "Numeric GitHub owner id (gh api repos/<owner>/<repo> --jq .owner.id)."
  type        = number
}

variable "github_repo_id" {
  description = "Numeric GitHub repo id (gh api repos/<owner>/<repo> --jq .id)."
  type        = number
}
