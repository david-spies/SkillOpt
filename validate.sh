#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# SkillOpt — validate.sh
# Validate a SKILL.md file for required structure and constraints.
#
# Usage:
#   bash validate.sh .agents/skills/rag-retrieval.md
#
# Exit codes:
#   0 — valid
#   1 — one or more validation errors
# ─────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
RST='\033[0m'

SKILL_PATH="${1:-}"

if [[ -z "$SKILL_PATH" ]]; then
  echo -e "${RED}✗${RST} Usage: bash validate.sh <path/to/SKILL.md>"
  exit 1
fi

if [[ ! -f "$SKILL_PATH" ]]; then
  echo -e "${RED}✗${RST} File not found: $SKILL_PATH"
  exit 1
fi

ERRORS=0
WARNINGS=0

fail() { echo -e "  ${RED}✗${RST} $1"; ((ERRORS++)) || true; }
warn() { echo -e "  ${YLW}⚠${RST} $1"; ((WARNINGS++)) || true; }
pass() { echo -e "  ${GRN}✓${RST} $1"; }

echo ""
echo "SkillOpt — Validating: $SKILL_PATH"
echo "──────────────────────────────────────"

# ── Required fields ──
echo "Required fields:"
for field in "name:" "description:" "version:" "author:"; do
  if grep -q "^${field}" "$SKILL_PATH"; then
    pass "$field present"
  else
    fail "$field missing from header"
  fi
done

# ── Required sections ──
echo ""
echo "Required sections:"
for section in "## Instructions" "## Input" "## Output" "## Examples"; do
  if grep -q "^${section}" "$SKILL_PATH"; then
    pass "${section} section present"
  else
    fail "${section} section missing"
  fi
done

# ── Optional but recommended ──
echo ""
echo "Recommended sections:"
for section in "## on_fail" "## Notes"; do
  if grep -q "^${section}" "$SKILL_PATH"; then
    pass "${section} present"
  else
    warn "${section} missing (recommended)"
  fi
done

# ── Line count ──
echo ""
echo "Constraints:"
MAX_LINES=200
LINE_COUNT=$(wc -l < "$SKILL_PATH")
if [[ "$LINE_COUNT" -le "$MAX_LINES" ]]; then
  pass "Line count: $LINE_COUNT / $MAX_LINES"
else
  fail "Line count: $LINE_COUNT exceeds max $MAX_LINES"
fi

# ── Instructions section not empty ──
INSTRUCTIONS_CONTENT=$(awk '/^## Instructions/{found=1; next} found && /^## /{exit} found{print}' "$SKILL_PATH")
if [[ -n "$INSTRUCTIONS_CONTENT" ]]; then
  INST_LINES=$(echo "$INSTRUCTIONS_CONTENT" | wc -l)
  pass "## Instructions section: $INST_LINES lines"
  if [[ "$INST_LINES" -lt 3 ]]; then
    warn "## Instructions section is very short — consider expanding"
  fi
else
  fail "## Instructions section is empty"
fi

# ── Description field quality ──
DESC=$(grep "^description:" "$SKILL_PATH" | head -1 | sed 's/^description://' | xargs)
DESC_LEN=${#DESC}
if [[ "$DESC_LEN" -lt 20 ]]; then
  warn "description: is very short ($DESC_LEN chars) — may reduce skill activation rate"
elif [[ "$DESC_LEN" -gt 300 ]]; then
  warn "description: is very long ($DESC_LEN chars) — may reduce clarity"
else
  pass "description: length ok ($DESC_LEN chars)"
fi

# ── No raw API keys or secrets ──
echo ""
echo "Security checks:"
if grep -qiE '(sk-ant-|ANTHROPIC_API_KEY|password\s*[:=]\s*\S|secret\s*[:=]\s*\S)' "$SKILL_PATH"; then
  fail "Possible hardcoded secret detected — review file contents"
else
  pass "No hardcoded secrets detected"
fi

# ── Encoding ──
if file "$SKILL_PATH" | grep -q "UTF-8\|ASCII"; then
  pass "Encoding: UTF-8 / ASCII compatible"
else
  warn "Non-UTF-8 encoding detected — may cause issues"
fi

# ── Summary ──
echo ""
echo "──────────────────────────────────────"
if [[ "$ERRORS" -eq 0 ]]; then
  echo -e "${GRN}✓ Validation passed${RST} ($WARNINGS warning(s))"
  exit 0
else
  echo -e "${RED}✗ Validation failed${RST} ($ERRORS error(s), $WARNINGS warning(s))"
  exit 1
fi
