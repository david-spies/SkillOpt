#!/usr/bin/env python3
"""
SkillOpt — Automated Prompt Optimizer
scripts/skillopt.py

Usage:
    python scripts/skillopt.py \
        --skill .agents/skills/rag-retrieval.md \
        --golden-set evals/golden-set/general.json \
        --iterations 10 \
        --budget 3.00

This script is the CLI counterpart to the browser UI.
It reads a SKILL.md file, runs it against a golden set,
asks an optimizer LLM to rewrite the ## Instructions section,
and rejects rewrites that don't improve the benchmark score.
"""

import argparse
import json
import os
import re
import sys
import time
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import anthropic
except ImportError:
    print("[error] anthropic SDK not installed. Run: pip install anthropic")
    sys.exit(1)

# ─────────────────────────────────────────────────────────
# ANSI colors
# ─────────────────────────────────────────────────────────
class C:
    GRN  = "\033[92m"
    YLW  = "\033[93m"
    RED  = "\033[91m"
    BLU  = "\033[94m"
    GRY  = "\033[90m"
    WHT  = "\033[97m"
    RST  = "\033[0m"
    BOLD = "\033[1m"

def ok(msg):   print(f"{C.GRN}✓{C.RST} {msg}")
def info(msg): print(f"{C.BLU}→{C.RST} {msg}")
def warn(msg): print(f"{C.YLW}⚠{C.RST} {msg}")
def err(msg):  print(f"{C.RED}✗{C.RST} {msg}")
def dim(msg):  print(f"{C.GRY}{msg}{C.RST}")


# ─────────────────────────────────────────────────────────
# SKILL FILE PARSER
# ─────────────────────────────────────────────────────────
class SkillFile:
    """Read, parse, and write a SKILL.md file."""

    def __init__(self, path: str):
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(f"Skill file not found: {path}")
        self.raw = self.path.read_text(encoding="utf-8")
        self._sections = self._parse_sections()

    def _parse_sections(self) -> dict:
        """Split SKILL.md into named sections keyed by ## heading."""
        sections = {}
        current_key = "__preamble__"
        current_lines = []
        for line in self.raw.splitlines():
            if line.startswith("## "):
                sections[current_key] = "\n".join(current_lines)
                current_key = line[3:].strip()
                current_lines = [line]
            else:
                current_lines.append(line)
        sections[current_key] = "\n".join(current_lines)
        return sections

    @property
    def instructions(self) -> str:
        """Return the content of the ## Instructions section."""
        return self._sections.get("Instructions", "")

    @property
    def description(self) -> str:
        """Extract description: value from the YAML-like header."""
        match = re.search(r'^description:\s*(.+)$', self.raw, re.MULTILINE)
        return match.group(1).strip() if match else ""

    @property
    def line_count(self) -> int:
        return len(self.raw.splitlines())

    def replace_instructions(self, new_instructions: str) -> str:
        """Return the full file content with ## Instructions replaced."""
        if "## Instructions" not in self.raw:
            raise ValueError("No ## Instructions section found in skill file.")
        before, _, after_raw = self.raw.partition("## Instructions")
        # Find next ## heading to know where Instructions ends
        next_section = re.search(r'^## ', after_raw, re.MULTILINE)
        if next_section:
            tail = after_raw[next_section.start():]
        else:
            tail = ""
        return before + "## Instructions\n\n" + new_instructions.strip() + "\n\n" + tail

    def write(self, new_content: str):
        self.path.write_text(new_content, encoding="utf-8")
        self.raw = new_content
        self._sections = self._parse_sections()

    def backup(self) -> Path:
        """Create a versioned backup. Returns backup path."""
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = self.path.with_suffix(f".{ts}.bak.md")
        shutil.copy2(self.path, backup_path)
        return backup_path


# ─────────────────────────────────────────────────────────
# GOLDEN SET LOADER
# ─────────────────────────────────────────────────────────
class GoldenSet:
    """Load and partition evaluation scenarios from a JSON file."""

    def __init__(self, path: str, holdout_pct: float = 0.20):
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Golden set not found: {path}")
        raw = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            raise ValueError("Golden set must be a JSON array.")
        self.all_scenarios = raw
        # Partition: if scenario has explicit partition field, respect it
        explicit_holdout = [s for s in raw if s.get("partition") == "holdout"]
        explicit_train   = [s for s in raw if s.get("partition") == "train"]
        untagged         = [s for s in raw if "partition" not in s]

        if explicit_holdout or explicit_train:
            self.train   = explicit_train + untagged
            self.holdout = explicit_holdout
        else:
            # Auto-split
            n_hold = max(1, int(len(raw) * holdout_pct))
            self.holdout = raw[-n_hold:]
            self.train   = raw[:-n_hold]

    def summary(self) -> str:
        return f"{len(self.train)} train, {len(self.holdout)} holdout"


# ─────────────────────────────────────────────────────────
# LLM JUDGE — eval runner
# ─────────────────────────────────────────────────────────
class LLMJudge:
    """Evaluate skill instructions against a scenario set."""

    SYSTEM = """You are an LLM judge evaluating AI agent skill instructions.
Score how well the given instructions would produce correct outputs for the test scenarios.
Scale: 1.0 (poor) to 5.0 (excellent).

Return ONLY valid JSON matching this schema:
{
  "score": <float 1.0-5.0>,
  "pass_count": <int>,
  "fail_count": <int>,
  "failures": [
    {"scenario": "<short description>", "reason": "<why instructions fail this case>"}
  ]
}
No preamble, no markdown fences, just JSON."""

    def __init__(self, client: anthropic.Anthropic, model: str):
        self.client = client
        self.model  = model

    def evaluate(self, instructions: str, scenarios: list) -> dict:
        prompt = (
            f"Skill Instructions:\n```\n{instructions}\n```\n\n"
            f"Test Scenarios ({len(scenarios)} total):\n"
            + json.dumps(scenarios, indent=2)
            + "\n\nEvaluate and return JSON."
        )
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=self.SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        raw = re.sub(r"```json|```", "", raw).strip()
        try:
            data = json.loads(raw)
            return {
                "score":      float(data.get("score", 3.0)),
                "pass_count": int(data.get("pass_count", 0)),
                "fail_count": int(data.get("fail_count", 0)),
                "failures":   data.get("failures", []),
                "tokens":     resp.usage.input_tokens + resp.usage.output_tokens,
            }
        except json.JSONDecodeError:
            # Fallback: try to extract numeric score
            match = re.search(r'"score"\s*:\s*(\d+\.?\d*)', raw)
            score = float(match.group(1)) if match else 3.0
            return {"score": score, "pass_count": 0, "fail_count": 0, "failures": [], "tokens": 0}


# ─────────────────────────────────────────────────────────
# OPTIMIZER — rewrites ## Instructions
# ─────────────────────────────────────────────────────────
class Optimizer:
    """Ask an LLM to rewrite the ## Instructions section."""

    SYSTEM = """You are a prompt optimization expert specializing in AI agent skill files.

Your task: improve the ## Instructions section of a SKILL.md file based on observed failures.

Rules (non-negotiable):
1. Only modify content within ## Instructions — do not touch any other section.
2. Keep changes targeted and surgical — address specific failure cases.
3. Do not rewrite from scratch — preserve working patterns.
4. Maintain or reduce line count — never add instructions for their own sake.
5. Instructions must remain model-agnostic — no references to specific LLMs.
6. Return ONLY the improved ## Instructions section content.
   No preamble. No markdown fences. No "Here is the improved..." prefix.
   Start directly with the section content."""

    def __init__(self, client: anthropic.Anthropic, model: str, max_lines: int = 200):
        self.client    = client
        self.model     = model
        self.max_lines = max_lines

    def rewrite(self, current_instructions: str, failures: list, iteration: int) -> str:
        failure_block = "\n".join(
            f"  - Scenario: {f['scenario']}\n    Reason:   {f['reason']}"
            for f in failures
        ) if failures else "  (no specific failures — improve clarity and precision)"

        prompt = (
            f"Iteration: {iteration}\n\n"
            f"Observed failures in the current instructions:\n{failure_block}\n\n"
            f"Line count limit: {self.max_lines}\n\n"
            f"Current ## Instructions:\n{current_instructions}\n\n"
            "Rewrite the ## Instructions section to address these failures."
        )

        resp = self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            system=self.SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()


# ─────────────────────────────────────────────────────────
# MEMORIES LOG — append to MEMORIES.md
# ─────────────────────────────────────────────────────────
class MemoriesLog:
    def __init__(self, path: str = "MEMORIES.md"):
        self.path = Path(path)

    def append(self, entry: dict):
        ts = datetime.now().isoformat(timespec="seconds")
        block = (
            f"\n---\n"
            f"## SkillOpt Run — {ts}\n\n"
            f"```json\n{json.dumps(entry, indent=2)}\n```\n"
        )
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(block)


# ─────────────────────────────────────────────────────────
# BASELINE SAVER
# ─────────────────────────────────────────────────────────
class BaselineSaver:
    def __init__(self, baselines_dir: str = "evals/golden-set/baselines"):
        self.dir = Path(baselines_dir)
        self.dir.mkdir(parents=True, exist_ok=True)

    def save(self, skill_name: str, score: float, metadata: dict):
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        stem = Path(skill_name).stem
        path = self.dir / f"{stem}_{ts}.json"
        path.write_text(json.dumps({
            "skill":     skill_name,
            "score":     score,
            "timestamp": ts,
            **metadata,
        }, indent=2), encoding="utf-8")
        return path


# ─────────────────────────────────────────────────────────
# VALIDATE — run validate.sh if present
# ─────────────────────────────────────────────────────────
def run_validate(skill_path: str) -> bool:
    """Run validate.sh if it exists. Returns True if passes."""
    validate_script = Path("validate.sh")
    if not validate_script.exists():
        return True
    result = subprocess.run(
        ["bash", "validate.sh", skill_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        err(f"validate.sh failed:\n{result.stdout}\n{result.stderr}")
        return False
    return True


# ─────────────────────────────────────────────────────────
# COST ESTIMATOR
# ─────────────────────────────────────────────────────────
def estimate_cost(tokens: int, model: str) -> float:
    """Rough cost estimate based on model pricing (input + output averaged)."""
    rates = {
        "claude-opus-4-20250514":    0.000015,
        "claude-sonnet-4-20250514":  0.000003,
        "claude-haiku-4-5-20251001": 0.0000008,
    }
    rate = rates.get(model, 0.000003)
    return tokens * rate


# ─────────────────────────────────────────────────────────
# MAIN OPTIMIZATION LOOP
# ─────────────────────────────────────────────────────────
def run_optimization(args):
    print()
    print(f"{C.BOLD}{C.WHT}SkillOpt v1.0.0 — Automated Prompt Optimizer{C.RST}")
    print(f"{C.GRY}{'─' * 50}{C.RST}")
    print()

    # ── Init Anthropic client ──
    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        err("No API key found. Set ANTHROPIC_API_KEY or pass --api-key.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # ── Load skill ──
    info(f"Loading skill: {args.skill}")
    try:
        skill = SkillFile(args.skill)
    except FileNotFoundError as e:
        err(str(e)); sys.exit(1)

    if not skill.instructions:
        err("No ## Instructions section found in skill file.")
        sys.exit(1)

    info(f"Skill loaded — {skill.line_count} lines")

    # ── Load golden set ──
    info(f"Loading golden set: {args.golden_set}")
    try:
        golden = GoldenSet(args.golden_set, holdout_pct=args.holdout / 100)
    except (FileNotFoundError, ValueError) as e:
        err(str(e)); sys.exit(1)

    info(f"Golden set: {golden.summary()}")

    if len(golden.train) < 10:
        warn("Fewer than 10 training scenarios — optimization may overfit.")

    # ── Config summary ──
    print()
    dim(f"  optimizer model : {args.opt_model}")
    dim(f"  eval model      : {args.eval_model}")
    dim(f"  max iterations  : {args.iterations}")
    dim(f"  budget ceiling  : ${args.budget:.2f}")
    dim(f"  score threshold : {args.threshold}")
    dim(f"  min delta       : {args.min_delta}")
    dim(f"  max lines       : {args.max_lines}")
    dim(f"  git backup      : {'yes' if not args.no_git else 'no'}")
    print()

    # ── Initialize components ──
    judge     = LLMJudge(client, args.eval_model)
    optimizer = Optimizer(client, args.opt_model, args.max_lines)
    memories  = MemoriesLog(args.memories)
    baselines = BaselineSaver(args.baselines_dir)

    # ── Baseline eval ──
    info("Running baseline evaluation...")
    t0 = time.time()
    baseline_result = judge.evaluate(skill.instructions, golden.train)
    baseline_score  = baseline_result["score"]
    baseline_tokens = baseline_result.get("tokens", 0)
    baseline_cost   = estimate_cost(baseline_tokens, args.eval_model)

    ok(f"Baseline score: {C.YLW}{baseline_score:.2f}/5.0{C.RST} "
       f"({baseline_result['pass_count']} pass, {baseline_result['fail_count']} fail) "
       f"[{time.time()-t0:.1f}s]")
    print()

    if baseline_score >= args.threshold:
        ok(f"Baseline already meets threshold ({args.threshold}). No optimization needed.")
        sys.exit(0)

    # ── Backup original ──
    backup_path = None
    if not args.no_git:
        backup_path = skill.backup()
        info(f"Backup: {backup_path}")

    # ── Optimization state ──
    current_score        = baseline_score
    current_instructions = skill.instructions
    current_failures     = baseline_result["failures"]
    total_cost           = baseline_cost
    accepted_count       = 0
    rejected_count       = 0
    iter_log             = []

    # ── Main loop ──
    print(f"{C.GRY}{'─' * 50}{C.RST}")
    for i in range(1, args.iterations + 1):
        print(f"\n{C.BLU}iter {i}/{args.iterations}{C.RST}")

        # Budget check
        if total_cost >= args.budget:
            warn(f"Budget ceiling reached: ${total_cost:.2f} >= ${args.budget:.2f}")
            break

        # Rewrite
        info("Calling optimizer model...")
        t1 = time.time()
        try:
            new_instructions = optimizer.rewrite(
                current_instructions, current_failures, i
            )
        except Exception as e:
            err(f"Optimizer error: {e}")
            continue

        # Line count guard
        new_line_count = len(new_instructions.splitlines())
        if new_line_count > args.max_lines:
            warn(f"Rewrite exceeds max lines ({new_line_count} > {args.max_lines}) — rejecting")
            rejected_count += 1
            continue

        # Evaluate rewrite
        info("Evaluating rewritten instructions...")
        t2 = time.time()
        try:
            new_content = skill.replace_instructions(new_instructions)
            # Write to temp file for validation
            tmp_path = skill.path.with_suffix(".tmp.md")
            tmp_path.write_text(new_content, encoding="utf-8")

            # Validate schema
            if not args.no_validate and not run_validate(str(tmp_path)):
                tmp_path.unlink(missing_ok=True)
                warn("Validation failed — rejecting rewrite")
                rejected_count += 1
                continue

            tmp_path.unlink(missing_ok=True)
            eval_result = judge.evaluate(new_instructions, golden.train)
        except Exception as e:
            err(f"Eval error: {e}")
            continue

        new_score = eval_result["score"]
        delta     = new_score - current_score
        iter_cost = estimate_cost(eval_result.get("tokens", 0), args.eval_model)
        total_cost += iter_cost

        iter_entry = {
            "iter":    i,
            "before":  round(current_score, 3),
            "after":   round(new_score, 3),
            "delta":   round(delta, 3),
            "time_s":  round(time.time() - t1, 1),
            "cost":    round(iter_cost, 4),
        }

        # ── Quality gate ──
        if delta >= args.min_delta:
            # Accept rewrite
            current_score        = new_score
            current_instructions = new_instructions
            current_failures     = eval_result["failures"]
            accepted_count       += 1
            iter_entry["verdict"] = "accepted"

            skill.write(skill.replace_instructions(new_instructions))

            ok(f"Accepted: {iter_entry['before']:.2f} → {current_score:.2f} "
               f"(Δ+{delta:.2f}) [{time.time()-t1:.1f}s] ${iter_cost:.3f}")

            # Holdout check every 3 accepts
            if accepted_count % 3 == 0 and golden.holdout:
                info(f"Running holdout check ({len(golden.holdout)} scenarios)...")
                ho_result = judge.evaluate(current_instructions, golden.holdout)
                dim(f"  holdout score: {ho_result['score']:.2f} "
                    f"(train: {current_score:.2f}, gap: {current_score - ho_result['score']:+.2f})")
                if current_score - ho_result["score"] > 0.5:
                    warn("Large train/holdout gap — possible overfitting. Consider stopping.")

        else:
            rejected_count      += 1
            iter_entry["verdict"] = "rejected"
            print(f"{C.RED}✗{C.RST} Rejected: {iter_entry['before']:.2f} → {new_score:.2f} "
                  f"(Δ{delta:.2f}) — below min delta {args.min_delta}")

        iter_log.append(iter_entry)

        # Threshold check
        if current_score >= args.threshold:
            ok(f"Score threshold {args.threshold} reached — stopping early at iter {i}")
            break

    # ── Final holdout eval ──
    print(f"\n{C.GRY}{'─' * 50}{C.RST}")
    if golden.holdout:
        info("Final holdout evaluation...")
        final_holdout = judge.evaluate(current_instructions, golden.holdout)
        ok(f"Holdout: {final_holdout['score']:.2f}/5.0 "
           f"(train: {current_score:.2f}, gap: {current_score - final_holdout['score']:+.2f})")
    else:
        final_holdout = {"score": None}

    # ── Save outputs ──
    info(f"Writing optimized skill → {args.skill}")
    skill.write(skill.replace_instructions(current_instructions))

    baseline_path = baselines.save(
        Path(args.skill).name,
        current_score,
        {"baseline": baseline_score, "iterations": len(iter_log), "cost": round(total_cost, 4)},
    )
    info(f"Baseline saved → {baseline_path}")

    memories_entry = {
        "skill":           Path(args.skill).name,
        "run_date":        datetime.now().isoformat(timespec="seconds"),
        "baseline_score":  round(baseline_score, 3),
        "final_score":     round(current_score, 3),
        "improvement":     round(current_score - baseline_score, 3),
        "holdout_score":   round(final_holdout["score"], 3) if final_holdout["score"] else None,
        "iterations":      len(iter_log),
        "accepted":        accepted_count,
        "rejected":        rejected_count,
        "total_cost_usd":  round(total_cost, 4),
        "opt_model":       args.opt_model,
        "eval_model":      args.eval_model,
        "backup":          str(backup_path) if backup_path else None,
        "iter_log":        iter_log,
    }
    memories.append(memories_entry)
    info(f"MEMORIES.md updated → {args.memories}")

    # ── Summary ──
    print()
    print(f"{C.BOLD}{'─' * 50}{C.RST}")
    improvement = current_score - baseline_score
    color = C.GRN if improvement > 0 else C.RED
    print(f"{C.BOLD}  SkillOpt complete{C.RST}")
    print(f"  baseline   : {baseline_score:.2f}/5.0")
    print(f"  final      : {color}{current_score:.2f}/5.0{C.RST}  ({improvement:+.2f})")
    print(f"  iterations : {len(iter_log)}  ({accepted_count} accepted, {rejected_count} rejected)")
    print(f"  total cost : ${total_cost:.3f}")
    if backup_path:
        print(f"  backup     : {backup_path}")
    print(f"{'─' * 50}")
    print()

    return 0 if current_score > baseline_score else 1


# ─────────────────────────────────────────────────────────
# CLI ARGUMENT PARSER
# ─────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="skillopt",
        description="SkillOpt — Automated prompt optimizer for SKILL.md files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic run
  python scripts/skillopt.py --skill .agents/skills/rag-retrieval.md

  # Full configuration
  python scripts/skillopt.py \\
      --skill .agents/skills/rag-retrieval.md \\
      --golden-set evals/golden-set/general.json \\
      --opt-model claude-opus-4-20250514 \\
      --eval-model claude-sonnet-4-20250514 \\
      --iterations 10 \\
      --budget 3.00 \\
      --threshold 4.8 \\
      --min-delta 0.05

  # Quick cheap run
  python scripts/skillopt.py \\
      --skill .agents/skills/code-review.md \\
      --eval-model claude-haiku-4-5-20251001 \\
      --iterations 5 \\
      --budget 0.50
        """
    )

    p.add_argument("--skill",
        required=True,
        help="Path to the target SKILL.md file")
    p.add_argument("--golden-set",
        default="evals/golden-set/general.json",
        help="Path to the golden set JSON file (default: evals/golden-set/general.json)")
    p.add_argument("--opt-model",
        default="claude-sonnet-4-20250514",
        help="Optimizer model — rewrites ## Instructions (default: claude-sonnet-4-20250514)")
    p.add_argument("--eval-model",
        default="claude-sonnet-4-20250514",
        help="Eval model — runs the benchmark judge (default: claude-sonnet-4-20250514)")
    p.add_argument("--iterations",
        type=int, default=10,
        help="Maximum optimization iterations (default: 10)")
    p.add_argument("--budget",
        type=float, default=3.00,
        help="API cost ceiling in USD (default: 3.00)")
    p.add_argument("--threshold",
        type=float, default=4.8,
        help="Stop if score reaches this value (default: 4.8)")
    p.add_argument("--min-delta",
        type=float, default=0.05,
        help="Minimum score improvement to accept a rewrite (default: 0.05)")
    p.add_argument("--max-lines",
        type=int, default=200,
        help="Max line count for ## Instructions section (default: 200)")
    p.add_argument("--holdout",
        type=float, default=20.0,
        help="Percentage of scenarios to withhold from optimization (default: 20.0)")
    p.add_argument("--memories",
        default="MEMORIES.md",
        help="Path to MEMORIES.md for run log (default: MEMORIES.md)")
    p.add_argument("--baselines-dir",
        default="evals/golden-set/baselines",
        help="Directory to save baseline scores (default: evals/golden-set/baselines)")
    p.add_argument("--api-key",
        default="",
        help="Anthropic API key (overrides ANTHROPIC_API_KEY env var)")
    p.add_argument("--no-git",
        action="store_true",
        help="Skip creating a .bak.md backup before writing")
    p.add_argument("--no-validate",
        action="store_true",
        help="Skip running validate.sh after each accepted rewrite")
    p.add_argument("--dry-run",
        action="store_true",
        help="Run eval and optimizer but do not write changes to disk")

    return p


# ─────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = build_parser()
    args   = parser.parse_args()

    if args.dry_run:
        warn("Dry-run mode — no files will be written.")

    sys.exit(run_optimization(args))
