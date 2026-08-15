# infra/terraform

One IAM role (`job-count-tracker-github-actions`) that this repo's GitHub
Action assumes via OIDC to read job-scraper's DynamoDB job-count data. See
`main.tf`'s top comment for the full picture.

State is **local, not committed** (`.gitignore`d) -- this stack is small
enough (3 resources) that a remote S3 backend isn't worth the extra setup.
Applied by hand, from a local session with AWS admin access to the same
account job-scraper itself deploys into.

## First-time apply

1. Make sure the repo already exists on GitHub (the trust policy needs its
   real numeric IDs, not just its name).
2. Get the numeric owner/repo IDs:
   ```
   gh api repos/<owner>/<repo> --jq '{owner_id: .owner.id, repo_id: .id}'
   ```
3. Apply:
   ```
   cd infra/terraform
   terraform init
   terraform apply \
     -var="github_owner_id=<owner_id from step 2>" \
     -var="github_repo_id=<repo_id from step 2>"
   ```
4. Copy the printed `role_arn` output into
   `.github/workflows/update-data.yml`'s `DATA_ROLE_ARN` env var.

## If the first real Action run gets "Not authorized to perform
sts:AssumeRoleWithWebIdentity"

The `sub` claim format is derived, not guessed, but it's still worth a real
verification. Read the actual rejected claim via CloudTrail:

```
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity
```

...and look at the denied event's `userIdentity.userName` -- if it doesn't
match what's in `main.tf`'s trust condition, fix the mismatch and
`terraform apply` again.

## Re-running `terraform apply` later

Safe and idempotent -- e.g. if the role's policy ever needs to change. This
repo's own GitHub Action never touches Terraform; it only ever assumes the
role this creates, so there's no risk of CI and a local apply racing each
other.
