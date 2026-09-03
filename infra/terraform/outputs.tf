output "role_arn" {
  description = "Put this in .github/workflows/update-data.yml's DATA_ROLE_ARN."
  value       = aws_iam_role.tracker_github_actions.arn
}
