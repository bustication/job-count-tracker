# Job Count Tracker

A small static web page that trends how many open jobs each company has,
per day, on a line graph. Data comes from a separate personal project
("job scraper") that already scrapes ~169 companies' job boards daily —
this project reads that project's job-count snapshots (read-only) and
gives them a permanent home, since the source project only ever keeps the
single latest value per company.

**Live page**: enable GitHub Pages (Settings → Pages → Deploy from branch:
`main` / root) and it'll be at `https://<owner>.github.io/job-count-tracker/`.

## How it works

```
job-scraper's DynamoDB table (job-scraper-seen)   -- read-only, untouched
        |  dynamodb:Scan, filtered to "count#*" items
        v
GitHub Action (this repo, scheduled Tue-Sat, OIDC -> a narrow IAM role)
        |  appends today's Pacific-date row per company
        v
data/history.csv   -- committed here, permanent, append-only
        |  served as a static file
        v
GitHub Pages (index.html + Chart.js + assets/app.js)
        |  fetch() + render
        v
Interactive line chart -- up to 8 companies shown at once, search + checkbox
```

- **Zero changes to job-scraper's own repo/pipeline.** This project only
  ever reads job-scraper's DynamoDB table, via a role that can do nothing
  but `dynamodb:Scan` that one table (see `infra/terraform/`).
- **No backend server.** GitHub Pages serves static files; a scheduled
  GitHub Action (`.github/workflows/update-data.yml`) is the only thing
  that runs on a schedule, and it just appends to a CSV and commits.
- **Weekends are skipped on purpose** — job-scraper itself only scrapes
  weekdays, so there's nothing new to record on a weekend.

## One-time setup

See `infra/terraform/README.md` for the IAM role setup (must be applied
once, manually, from an AWS session with access to job-scraper's account).

## Local development

Open `index.html` directly, or serve the directory with any static file
server (needed for `fetch()` to work under `file://` restrictions in some
browsers) — e.g. `python -m http.server` from the repo root.
