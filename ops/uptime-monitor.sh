#!/usr/bin/env bash
# ops/uptime-monitor.sh — T3.14.03: the UptimeRobot monitor on /api/health, alerting Jon + the operator.
# Operator-only; the app never runs it. Run ONLY after J.13 (Jon connected Google in production): before that
# the site has nothing to watch and every alert would be noise. Idempotent: an existing monitor for the URL is
# reported, never duplicated. Dry run by default; --apply creates it.
#
#   UPTIMEROBOT_API_KEY=… (from your secret store) \
#     ops/uptime-monitor.sh https://timewithjon.com/api/health jon@example.com operator@example.com [--apply]
#
# Why 5 minutes: /api/health turns 503 when the tick is 35+ min late, so a stopped pg_cron job alerts within
# ~40 minutes (T3.14 AC1: under 45). Both addresses must already be verified alert contacts in UptimeRobot
# (it emails each one a confirmation link when they are added); the script refuses to guess.
set -euo pipefail
API=${UPTIMEROBOT_API:-https://api.uptimerobot.com/v2} # overridable only for a local stub test
URL=${1:?usage: uptime-monitor.sh <health-url> <jon-email> <operator-email> [--apply]}
JON=${2:?jon email}
OPERATOR=${3:?operator email}
APPLY=${4:-}
: "${UPTIMEROBOT_API_KEY:?set UPTIMEROBOT_API_KEY from your secret store}"
[[ "$URL" == https://*/api/health ]] || { echo "refusing: the URL must be https://…/api/health" >&2; exit 2; }

# pr41 F4: the key goes in on stdin (curl joins every -d part with &), never on argv where `ps` can read it.
# pr41 F5: UptimeRobot answers HTTP 200 {"stat":"fail"} on a bad key or a limit: fail loudly with its error type.
call() {
  printf 'api_key=%s' "$UPTIMEROBOT_API_KEY" |
    curl -fsS -X POST "$API/$1" --data-binary @- -d format=json "${@:2}" |
    jq -e 'if .stat == "ok" then . else error("uptimerobot: \(.error.type // "fail")") end'
}

existing=$(call getMonitors --data-urlencode "search=$URL" | jq -r --arg u "$URL" '[.monitors[]? | select(.url == $u)] | length')
if [[ "$existing" != 0 ]]; then echo "monitor for $URL already exists: nothing to do"; exit 0; fi

contacts=$(call getAlertContacts)
ids=()
for email in "$JON" "$OPERATOR"; do
  id=$(jq -r --arg e "$email" '[.alert_contacts[]? | select((.value | ascii_downcase) == ($e | ascii_downcase) and .status == 2) | .id][0] // empty' <<<"$contacts")
  [[ -n "$id" ]] || { echo "no ACTIVE alert contact for one of the addresses: add + verify it in UptimeRobot first" >&2; exit 3; }
  ids+=("${id}_0_0") # threshold 0, recurrence 0 (alert once per incident)
done

echo "plan: HTTP(s) monitor 'Time with Jon /api/health' on $URL every 300 s, alerting 2 contacts"
[[ "$APPLY" == --apply ]] || { echo "dry run: pass --apply to create it"; exit 0; }
call newMonitor -d type=1 -d interval=300 --data-urlencode "friendly_name=Time with Jon /api/health" \
  --data-urlencode "url=$URL" --data-urlencode "alert_contacts=$(IFS=-; echo "${ids[*]}")" >/dev/null ||
  { echo "create failed" >&2; exit 4; }
echo "created"
