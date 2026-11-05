#!/usr/bin/env bash
# Creates or updates the repository's labels, milestones and Projects board via gh.
# Idempotent: anything already in the desired state is left untouched, and nothing is
# ever deleted. Runs on the bash 3.2 that ships with macOS (no associative arrays).
#
# Usage:
#   GH_TOKEN=$(gh auth token --user tomer-shvadron) scripts/github/bootstrap.sh
#   DRY_RUN=1 scripts/github/bootstrap.sh      # print the writes instead of making them
#
# Overrides: REPO (owner/name), PROJECT_OWNER, PROJECT_TITLE.

set -euo pipefail

REPO="${REPO:-tomer-shvadron/reprise}"
PROJECT_OWNER="${PROJECT_OWNER:-${REPO%%/*}}"
PROJECT_TITLE="${PROJECT_TITLE:-Reprise}"
DRY_RUN="${DRY_RUN:-0}"

# name|colour|description
LABELS=(
  "area:model|0E8A16|Touches packages/model or apps/model"
  "area:formats|0E8A16|Touches packages/formats or apps/formats"
  "area:layout|0E8A16|Touches packages/layout or apps/layout"
  "area:audio|0E8A16|Touches packages/audio or apps/audio"
  "area:web|0E8A16|Touches packages/web or apps/web"
  "area:desktop|0E8A16|Touches packages/desktop or apps/desktop"
  "area:docs|0E8A16|Touches packages/docs or apps/docs"
  "area:repo|0E8A16|Touches packages/repo or apps/repo"
  "type:feature|1D76DB|New capability from a work package"
  "type:bug|D93F0B|Something is wrong"
  "type:chore|5319E7|Scaffolding, tooling, housekeeping"
  "type:test|BFD4F2|Tests, fixtures, benchmarks"
  "type:contract|B60205|Change to a frozen contract in packages/model or shared state; lead-only"
  "type:decision|FBCA04|Needs an ADR before work starts"
  "phase:0|C5DEF5|Roadmap phase 0"
  "phase:1|C5DEF5|Roadmap phase 1"
  "phase:2|C5DEF5|Roadmap phase 2"
  "phase:3|C5DEF5|Roadmap phase 3"
  "phase:4|C5DEF5|Roadmap phase 4"
  "lane:lead|000000|Serial or integration work done by the lead"
  "lane:score|E99695|Score lane: packages/layout, features/score, features/editor"
  "lane:audio|F9D0C4|Audio lane: packages/audio, features/sounds"
  "lane:formats|FEF2C0|Formats lane: packages/formats, features/library"
  "lane:app|C2E0C6|App lane: features/trainer"
)

# title|description
MILESTONES=(
  "Player|Open any supported file, read it as tab with rhythm stems, hear it through the GM tier with correct repeats and jumps, change tempo in BPM or percent, loop, mix, print. Budgets hold on the benchmark score."
  "Library|Imported songs in a searchable library; reopen with settings; save, save-as, export to gp with a lossy warning; drafts survive a crash."
  "Trainer|Speed trainer ramps a loop; mic tuner with cents; standalone metronome; practice log per song; live fretboard follows playback."
  "Editor|A new song written from scratch with the keyboard only, every in-scope effect applied and heard, saved native and exported as gp, with undo across all of it."
  "HQ Sound|A downloaded SFZ pack plays with articulation layers through an effects preset; memory under budget with four HQ tracks; switching songs evicts."
  "Release|v1 tag, macOS and Windows installers on a GitHub Release, light theme audited, shortcut map complete."
)

# name|colour|description, in board order
STATUS_OPTIONS=(
  "Backlog|GRAY|Filed, not yet ready to start"
  "Ready|BLUE|Unblocked and briefed; can be picked up"
  "In progress|YELLOW|A branch exists and work is under way"
  "In review|PURPLE|PR open, waiting on review"
  "Done|GREEN|Merged"
)

SCOPE_HINT="gh auth refresh -s project,read:project"
changes=0

log() { printf '%s\n' "$*"; }

run() {
  changes=$((changes + 1))
  if [ "$DRY_RUN" = "1" ]; then
    log "  [dry run] $*"
  else
    "$@" >/dev/null
  fi
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

sync_labels() {
  log "Labels in $REPO"
  local existing entry name colour description current cur_colour cur_description
  existing=$(gh label list -R "$REPO" --limit 500 --json name,color,description \
    --jq '.[] | [.name, .color, .description] | @tsv')

  for entry in "${LABELS[@]}"; do
    IFS='|' read -r name colour description <<<"$entry"
    current=$(printf '%s\n' "$existing" | awk -F'\t' -v n="$name" '$1 == n' || true)
    if [ -z "$current" ]; then
      log "  create $name"
      run gh label create "$name" -R "$REPO" --color "$colour" --description "$description"
      continue
    fi
    IFS=$'\t' read -r _ cur_colour cur_description <<<"$current"
    if [ "$(lower "$cur_colour")" = "$(lower "$colour")" ] && [ "$cur_description" = "$description" ]; then
      log "  ok     $name"
    else
      log "  update $name"
      run gh label edit "$name" -R "$REPO" --color "$colour" --description "$description"
    fi
  done
}

sync_milestones() {
  log "Milestones in $REPO"
  local existing entry title description current number cur_description
  existing=$(gh api "repos/$REPO/milestones?state=all&per_page=100" --paginate \
    --jq '.[] | [.number, .title, (.description // "")] | @tsv')

  for entry in "${MILESTONES[@]}"; do
    IFS='|' read -r title description <<<"$entry"
    current=$(printf '%s\n' "$existing" | awk -F'\t' -v t="$title" '$2 == t' || true)
    if [ -z "$current" ]; then
      log "  create $title"
      run gh api -X POST "repos/$REPO/milestones" -f title="$title" -f description="$description"
      continue
    fi
    IFS=$'\t' read -r number _ cur_description <<<"$current"
    if [ "$cur_description" = "$description" ]; then
      log "  ok     $title (#$number)"
    else
      log "  update $title (#$number)"
      run gh api -X PATCH "repos/$REPO/milestones/$number" -f description="$description"
    fi
  done
}

status_options_graphql() {
  local entry name colour description out=""
  for entry in "${STATUS_OPTIONS[@]}"; do
    IFS='|' read -r name colour description <<<"$entry"
    out="$out{name: \"$name\", color: $colour, description: \"$description\"},"
  done
  printf '[%s]' "${out%,}"
}

sync_project() {
  log "Projects board \"$PROJECT_TITLE\" for $PROJECT_OWNER"
  local projects err number created=0
  err=$(mktemp)
  if ! projects=$(gh project list --owner "$PROJECT_OWNER" --limit 100 --format json \
    --jq ".projects[] | select(.title == \"$PROJECT_TITLE\") | .number" 2>"$err"); then
    log "  skipped: the token cannot read Projects ($(head -n 1 "$err"))"
    log "  grant the scope, then run this script again:"
    log "    $SCOPE_HINT"
    rm -f "$err"
    return 0
  fi
  rm -f "$err"

  number=$(printf '%s\n' "$projects" | head -n 1)
  if [ -z "$number" ]; then
    log "  create board"
    if [ "$DRY_RUN" = "1" ]; then
      run gh project create --owner "$PROJECT_OWNER" --title "$PROJECT_TITLE"
      log "  [dry run] then link it to $REPO and set its Status options"
      return 0
    fi
    number=$(gh project create --owner "$PROJECT_OWNER" --title "$PROJECT_TITLE" \
      --format json --jq '.number')
    changes=$((changes + 1))
    created=1
  else
    log "  ok     board exists (#$number)"
  fi

  local linked
  linked=$(gh api graphql -F owner="${REPO%%/*}" -F name="${REPO#*/}" -f query='
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { projectsV2(first: 100) { nodes { number } } }
    }' --jq ".data.repository.projectsV2.nodes[] | select(.number == $number) | .number")
  if [ -n "$linked" ]; then
    log "  ok     linked to $REPO"
  else
    log "  link to $REPO"
    run gh project link "$number" --owner "$PROJECT_OWNER" --repo "$REPO"
  fi

  local field_id current_options desired_options entry name
  field_id=$(gh project field-list "$number" --owner "$PROJECT_OWNER" --format json \
    --jq '.fields[] | select(.name == "Status") | .id')
  current_options=$(gh project field-list "$number" --owner "$PROJECT_OWNER" --format json \
    --jq '[.fields[] | select(.name == "Status") | .options[].name] | join("|")')
  desired_options=""
  for entry in "${STATUS_OPTIONS[@]}"; do
    IFS='|' read -r name _ <<<"$entry"
    desired_options="$desired_options|$name"
  done
  desired_options="${desired_options#|}"

  if [ "$current_options" = "$desired_options" ]; then
    log "  ok     Status options: ${desired_options//|/, }"
  elif [ "$created" = "1" ]; then
    # Replacing single-select options drops every item's value, so only a board this
    # run created (and that therefore has no items) is rewritten.
    log "  set    Status options: ${desired_options//|/, }"
    run gh api graphql -f fieldId="$field_id" -f query="
      mutation(\$fieldId: ID!) {
        updateProjectV2Field(input: {fieldId: \$fieldId, singleSelectOptions: $(status_options_graphql)}) {
          projectV2Field { ... on ProjectV2SingleSelectField { id } }
        }
      }"
  else
    log "  warn   Status options are \"${current_options//|/, }\", expected \"${desired_options//|/, }\""
    log "         left alone: rewriting them would clear the Status of every item on the board"
  fi
}

command -v gh >/dev/null || { log "gh is not installed: https://cli.github.com"; exit 1; }

sync_labels
sync_milestones
sync_project

if [ "$DRY_RUN" = "1" ]; then
  log "Dry run: $changes write(s) would be made."
else
  log "Done: $changes write(s) made."
fi
