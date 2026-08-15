"""Daily poller: read job-scraper's DynamoDB job-count snapshot and append
today's reading (per company) to data/history.csv.

Read-only against job-scraper's own AWS resources -- this project never
writes to, nor manages, anything in that project. See README.md for the
full picture: job-scraper's `job-scraper-seen` DynamoDB table stores one
`count#<company>` item per company, overwritten on every job-scraper run
with no history and a 14-day TTL. This script is the thing that actually
gives that data a permanent home, by scanning the table once a day and
appending a row per company to a plain CSV committed to this repo.

Company discovery is a `Scan` filtered to `dedup_id` values starting with
`count#`, not a hardcoded company list -- so this stays in sync with
job-scraper's own roster (companies added/removed there show up here
automatically) without needing any manual sync step. The table holds no
sensitive data (job counts + dedup bookkeeping only), so a whole-table Scan
is an acceptable IAM grant for a role that can do nothing else (see
infra/terraform/main.tf -- the granted policy is `dynamodb:Scan` only, on
this one table's ARN).

Idempotent per Pacific calendar date: re-running this on the same day is a
no-op if that date's rows are already in the CSV (see main()) -- safe to
re-trigger the GitHub Action by hand without creating duplicate rows.
"""
from __future__ import annotations

import csv
import pathlib
from datetime import datetime
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Attr

TABLE_NAME = "job-scraper-seen"
REGION = "us-west-2"
COUNT_PREFIX = "count#"

# The date a row is stamped with is the Pacific business day the count
# reflects -- job-scraper's own schedule runs on Pacific time (weekdays,
# last run 17:00 PT), and this poller itself runs a few hours after
# midnight UTC (see .github/workflows/update-data.yml), which is still the
# *same* Pacific evening/night, not yet the next Pacific day. Using
# datetime.now(UTC).date() here would mislabel rows by one day whenever the
# poller runs between UTC midnight and Pacific midnight (i.e. most of the
# time it actually runs).
_PACIFIC = ZoneInfo("America/Los_Angeles")


def fetch_counts(table_name: str = TABLE_NAME, region: str = REGION) -> dict[str, int]:
    """Return {company_name: job_count} by scanning job-scraper's table for
    every count# item, paginating through the full table."""
    table = boto3.resource("dynamodb", region_name=region).Table(table_name)
    counts: dict[str, int] = {}
    scan_kwargs: dict = {"FilterExpression": Attr("dedup_id").begins_with(COUNT_PREFIX)}
    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            company = item["dedup_id"][len(COUNT_PREFIX):]
            counts[company] = int(item["count"])
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    return counts


def _existing_dates(path: pathlib.Path) -> set[str]:
    if not path.exists():
        return set()
    with path.open(newline="", encoding="utf-8") as fh:
        return {row["date"] for row in csv.DictReader(fh)}


def main(path: str = "data/history.csv") -> None:
    today = datetime.now(_PACIFIC).date().isoformat()
    csv_path = pathlib.Path(path)

    if today in _existing_dates(csv_path):
        print(f"{today} already recorded in {csv_path} -- no-op")
        return

    counts = fetch_counts()
    if not counts:
        # Never write an empty snapshot -- a transient AWS/table hiccup
        # returning zero rows should not silently blank out a day. Fail
        # loudly instead so the Action shows red and it gets noticed.
        raise RuntimeError(
            "fetch_counts() returned 0 companies -- refusing to write an "
            "empty snapshot (likely a transient AWS issue, not a real "
            "0-company day)"
        )

    write_header = not csv_path.exists()
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if write_header:
            writer.writerow(["date", "company", "count"])
        for company in sorted(counts):
            writer.writerow([today, company, counts[company]])

    print(f"Appended {len(counts)} rows for {today} to {csv_path}")


if __name__ == "__main__":
    main()
