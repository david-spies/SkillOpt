#!/usr/bin/env python3
"""
SkillOpt — eval-runner.py
Run the LLM judge against a skill and golden set.

Usage:
    python scripts/eval-runner.py \
        --skill .agents/skills/rag-retrieval.md \
        --golden-set evals/golden-set/general.json

    # Compare against saved baseline
    python scripts/eval-runner.py \
        --skill .agents/skills/rag-retrieval.md \
        --compare-baseline evals/golden-set/baselines/rag-retrieval_20250529_120000.json
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from datetime import datetime

try:
    import anthropic
except ImportError:
    print("[error] anthropic SDK not installed. Run: pip install anthropic")
    sys.exit(1)


# ─────────────────────────────────────────────────────────
# ANSI helpers
# ─────────────────────────────────────────────────────────
GRN = "\033[92m"; YLW = "\033[93m"; RED = "\033[91m"
BLU = "\033[94m"; GRY = "\033[90m"; WHT = "\033[97m"
BLD = "\033[1m";  RST = "\033[0m"


JUDGE_SYSTEM = """You are an LLM judge evaluating AI agent skill instructions.

For each test scenario, determine whether the provided skill instructions would produce
a correct, high-quality output.

Score 1.0–5.0:
  5.0 — instructions clearly handle all scenarios correctly
  4.0 — instructions handle most scenarios with minor gaps
  3.0 — instructions partially address scenarios, notable gaps
  2.0 — instructions miss several key scenarios
  1.0 — instructions fail to address the scenarios

Return ONLY valid JSON:
{
  "score": <float>,
  "pass_count": <int>,
  "fail_count": <int>,
  "details": [
    {"scenario_id": <int or null>, "scenario": "<short>", "pass": <bool>, "reason": "<explanation>"}
  ],
  "failures": [
    {"scenario": "<short>", "reason": "<why instructions fail>"}
  ],
  "summary": "<one-sentence overall assessment>"
}"""


def run_judge(client: anthropic.Anthropic, model: str, instructions: str, scenarios: list) -> dict:
    prompt = (
        f"Skill Instructions:\n```\n{instructions}\n```\n\n"
        f"Test Scenarios ({len(scenarios)}):\n"
        + json.dumps(scenarios, indent=2)
        + "\n\nScore these instructions against the scenarios."
    )
    resp = client.messages.create(
        model=model,
        max_tokens=2048,
        system=JUDGE_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = resp.content[0].text.strip()
    raw = re.sub(r"```json|```", "", raw).strip()
    try:
        data = json.loads(raw)
        data["tokens"] = resp.usage.input_tokens + resp.usage.output_tokens
        return data
    except json.JSONDecodeError:
        match = re.search(r'"score"\s*:\s*(\d+\.?\d*)', raw)
        score = float(match.group(1)) if match else 3.0
        return {"score": score, "pass_count": 0, "fail_count": 0,
                "details": [], "failures": [], "summary": raw[:200], "tokens": 0}


def load_skill_instructions(path: str) -> str:
    content = Path(path).read_text(encoding="utf-8")
    match = re.search(r'## Instructions\n(.*?)(?=\n## |\Z)', content, re.DOTALL)
    if not match:
        print(f"{RED}✗{RST} No ## Instructions section found in {path}")
        sys.exit(1)
    return match.group(1).strip()


def load_golden(path: str) -> list:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("Golden set must be a JSON array")
    return data


def print_result(result: dict, label: str = ""):
    score = result["score"]
    color = GRN if score >= 4.5 else YLW if score >= 3.5 else RED
    tag = f" [{label}]" if label else ""
    print(f"\n{BLD}Score{tag}: {color}{score:.2f}/5.0{RST}")
    print(f"  pass: {result.get('pass_count', '—')}  fail: {result.get('fail_count', '—')}")
    if result.get("summary"):
        print(f"  {GRY}{result['summary']}{RST}")
    if result.get("failures"):
        print(f"\n{YLW}Failures:{RST}")
        for f in result["failures"]:
            print(f"  {RED}•{RST} {f.get('scenario', '?')}")
            print(f"    {GRY}{f.get('reason', '')}{RST}")


def main():
    p = argparse.ArgumentParser(
        prog="eval-runner",
        description="SkillOpt eval runner — score a SKILL.md against a golden set"
    )
    p.add_argument("--skill",       required=True, help="Path to SKILL.md")
    p.add_argument("--golden-set",  required=True, help="Path to golden set JSON")
    p.add_argument("--model",       default="claude-sonnet-4-20250514", help="Judge model")
    p.add_argument("--api-key",     default="", help="Anthropic API key")
    p.add_argument("--compare-baseline", default="", help="Path to saved baseline JSON to compare against")
    p.add_argument("--save-baseline",    action="store_true", help="Save result as new baseline")
    p.add_argument("--output",      default="", help="Path to write JSON result")
    p.add_argument("--partition",   default="all", choices=["all","train","holdout"], help="Which scenarios to evaluate")
    args = p.parse_args()

    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print(f"{RED}✗{RST} No API key. Set ANTHROPIC_API_KEY or pass --api-key.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    print(f"\n{BLD}{WHT}SkillOpt — eval-runner{RST}")
    print(f"{GRY}{'─' * 44}{RST}")
    print(f"{BLU}→{RST} skill      : {args.skill}")
    print(f"{BLU}→{RST} golden set : {args.golden_set}")
    print(f"{BLU}→{RST} model      : {args.model}")

    instructions = load_skill_instructions(args.skill)
    all_scenarios = load_golden(args.golden_set)

    # Filter by partition
    if args.partition == "train":
        scenarios = [s for s in all_scenarios if s.get("partition", "train") == "train"]
    elif args.partition == "holdout":
        scenarios = [s for s in all_scenarios if s.get("partition") == "holdout"]
    else:
        scenarios = all_scenarios

    print(f"{BLU}→{RST} scenarios  : {len(scenarios)} ({args.partition})")
    print()

    t0 = time.time()
    result = run_judge(client, args.model, instructions, scenarios)
    elapsed = time.time() - t0

    print_result(result)
    print(f"\n{GRY}  [{elapsed:.1f}s · {result.get('tokens', 0)} tokens]{RST}")

    # Compare baseline
    if args.compare_baseline and Path(args.compare_baseline).exists():
        baseline_data = json.loads(Path(args.compare_baseline).read_text())
        prev_score = baseline_data.get("score", 0)
        delta = result["score"] - prev_score
        color = GRN if delta > 0 else RED if delta < 0 else GRY
        print(f"\n{BLD}Baseline comparison:{RST}")
        print(f"  previous : {prev_score:.2f}/5.0  ({baseline_data.get('timestamp','')})")
        print(f"  current  : {result['score']:.2f}/5.0")
        print(f"  delta    : {color}{delta:+.2f}{RST}  {'✓ improved' if delta > 0 else '✗ regressed' if delta < 0 else '→ unchanged'}")

    # Save baseline
    if args.save_baseline:
        baselines_dir = Path("evals/golden-set/baselines")
        baselines_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        stem = Path(args.skill).stem
        out = baselines_dir / f"{stem}_{ts}.json"
        payload = {
            "skill":     args.skill,
            "score":     result["score"],
            "timestamp": ts,
            "model":     args.model,
            "scenarios": len(scenarios),
        }
        out.write_text(json.dumps(payload, indent=2))
        print(f"\n{GRN}✓{RST} Baseline saved → {out}")

    # Write JSON output
    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2))
        print(f"{GRN}✓{RST} Result written → {args.output}")

    return 0 if result["score"] >= 4.0 else 1


if __name__ == "__main__":
    sys.exit(main())
