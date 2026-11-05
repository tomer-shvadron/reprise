#!/usr/bin/env bash
# Applies the repository's merge settings and the branch protection on `main`.
# Idempotent: both calls replace the settings wholesale, so rerunning converges.
# Apply only after ci.yml is on main: a PR whose merge ref lacks it can never produce the
# required `ci` check, and enforce_admins leaves no bypass.
# Needs a token with admin rights on the repo, e.g. GH_TOKEN=$(gh auth token --user tomer-shvadron).
set -euo pipefail

repo="${1:-tomer-shvadron/reprise}"
branch="main"

gh api --method PATCH "repos/${repo}" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true \
  --silent

# No required approving reviews: every PR here is opened from the owner's own account, and
# GitHub does not let a PR's author approve it, so a required review would block every merge.
# enforce_admins is on so the owner, who is also the only admin, cannot merge past a red `ci`.
gh api --method PUT "repos/${repo}/branches/${branch}/protection" \
  --input - --silent <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["ci"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "Protection applied to ${repo}@${branch}."
