#!/usr/bin/env bash
# Runs the passive production scan in scripts/zap/production-passive.yaml and summarises it.
#
#   scripts/zap/run.sh [report-dir]
#
# Needs ZAP 2.17.0 (https://github.com/zaproxy/zaproxy/releases/tag/v2.17.0, SHA-256 of the cross-platform zip
# 94c8f767b1c2e94f0db66b3ae56514d5e3f5a728ee1b6c798e0c8fe2d61fbff0) and Java 17 or later. Set ZAP_HOME to the
# unpacked directory, or use the official image: docker run -v "$PWD:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable
# zap.sh -cmd -autorun /zap/wrk/scripts/zap/production-passive.yaml
#
# Exits non-zero if any finding is Medium or High risk.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ZAP_HOME="${ZAP_HOME:-$ROOT/.pytools/zap/ZAP_2.17.0}"
REPORT_DIR="$(mkdir -p "${1:-$ROOT/.kiro/artifacts/zap}" && cd "${1:-$ROOT/.kiro/artifacts/zap}" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -x "$ZAP_HOME/zap.sh" ] || { echo "ZAP not found at $ZAP_HOME. Set ZAP_HOME." >&2; exit 2; }

# A throwaway ZAP home, so nothing is written to the user's profile and every run starts clean. ZAP also opens a
# local proxy it does not need here; it gets a free loopback port so it cannot collide with anything on 8080.
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
# Without a User-Agent the WAF's managed rule NoUserAgent_HEADER blocks every request, and the scan ends up
# describing the block page instead of the application. The agent names the scan, so it is easy to find in logs.
USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) Theckards-passive-scan/1 (+https://github.com/KevinSsteve/theckards)"
REPORT_DIR="$REPORT_DIR" "$ZAP_HOME/zap.sh" -cmd -dir "$WORK" -silent -host 127.0.0.1 -port "$PORT" \
  -config "connection.defaultUserAgent=$USER_AGENT" \
  -autorun "$ROOT/scripts/zap/production-passive.yaml" > "$REPORT_DIR/zap-passive.log" 2>&1 || true

# A scan that saw block pages is describing the WAF, not the application. No public URL here answers 403, so
# any 403 in the findings means the scanner was blocked, and the run is refused rather than reported.
python3 - "$REPORT_DIR/zap-passive.json" <<'PY' || exit 2
import json, sys
try:
    report = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)  # a missing report is handled below
blocked = sorted({i["uri"] for s in report.get("site", []) for a in s.get("alerts", []) for i in a.get("instances", [])
                  if (i.get("response-header") or "").startswith("HTTP/1.1 403")})
if blocked:
    print(f"The WAF blocked the scanner on {len(blocked)} URLs, e.g. {blocked[0]}. Not reporting.", file=sys.stderr)
    sys.exit(1)
PY

REPORT="$REPORT_DIR/zap-passive.json"
[ -s "$REPORT" ] || { echo "ZAP produced no report. Log: $REPORT_DIR/zap-passive.log" >&2; tail -20 "$REPORT_DIR/zap-passive.log" >&2; exit 2; }

python3 - "$REPORT" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
order = {"3": "High", "2": "Medium", "1": "Low", "0": "Informational"}
alerts = []
for site in report.get("site", []):
    for alert in site.get("alerts", []):
        alerts.append((alert["riskcode"], alert["pluginid"], alert["name"], len(alert.get("instances", [])),
                       sorted({i.get("uri", "") for i in alert.get("instances", [])})[:3]))
alerts.sort(key=lambda a: (-int(a[0]), a[1]))
counts = {name: 0 for name in order.values()}
for risk, plugin, name, n, uris in alerts:
    counts[order[risk]] += 1
    print(f"{order[risk]:13} {plugin:>6}  {name}  ({n} instance{'s' if n != 1 else ''})")
    for uri in uris:
        print(f"{'':22}{uri}")
print()
print("Summary: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
sys.exit(1 if counts["High"] or counts["Medium"] else 0)
PY
