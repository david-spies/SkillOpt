![SkillOpt](/docs/skillopt_banner.svg)
![SkillOpt](https://img.shields.io/badge/SkillOpt-v1.1.0-4ade80?style=flat-square&labelColor=0c0c0c)
![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square&labelColor=0c0c0c)
![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?style=flat-square&logo=python&logoColor=white&labelColor=1a1a2e)
![Anthropic](https://img.shields.io/badge/Powered%20by-Anthropic-CC785C?style=flat-square&labelColor=1a1a1a)
![Claude](https://img.shields.io/badge/Claude-Sonnet%20%7C%20Opus%20%7C%20Haiku-D97757?style=flat-square&labelColor=1a1a1a)
![Tests](https://img.shields.io/badge/Tests-76%20passing-4ade80?style=flat-square&labelColor=0c0c0c)
![Quality Gate](https://img.shields.io/badge/Quality%20Gate-Enforced-4ade80?style=flat-square&labelColor=0c0c0c)
![Zero Server](https://img.shields.io/badge/Backend-Zero%20Server-60a5fa?style=flat-square&labelColor=0c0c0c)
![Privacy](https://img.shields.io/badge/Privacy-Local%20Only-a78bfa?style=flat-square&labelColor=0c0c0c)
![Model Agnostic](https://img.shields.io/badge/Skills-Model%20Agnostic-c084fc?style=flat-square&labelColor=0c0c0c)

# SkillOpt

**Automated prompt optimizer for AI agent skill files.**

SkillOpt replaces manual prompt tweaking with a mathematical feedback loop. A base model runs your tasks against a benchmark dataset while an optimizer model evaluates failures and rewrites the `## Instructions` section — automatically rejecting changes that don't improve the score.

> **SkillOpt is a post-deployment maintenance tool.** It does not replace the Ai-Agent Builder. It improves what the builder created, after real task data has accumulated.

---

## Table of Contents

- [What SkillOpt Does](#what-skillopt-does)
- [How It Works](#how-it-works)
- [Directory Structure](#directory-structure)
- [Quick Start](#quick-start)
- [Loading a Skill File](#loading-a-skill-file)
- [Browser UI](#browser-ui)
- [CLI Usage](#cli-usage)
- [Golden Set Format](#golden-set-format)
- [SKILL.md Format](#skillmd-format)
- [Configuration](#configuration)
- [Cost Management](#cost-management)
- [Quality Gate](#quality-gate)
- [Run History and MEMORIES.md](#run-history-and-memoriesmd)
- [Testing](#testing)
- [Workflow: Builder → SkillOpt](#workflow-builder--skillopt)
- [FAQ](#faq)

---

## What SkillOpt Does

At its core, SkillOpt is an automated optimization loop that:

1. Loads a SKILL.md file from any source — `.zip` package, file system path, or pasted text
2. Runs the `## Instructions` section against a benchmark dataset (your golden set)
3. Uses an optimizer model to analyze failures and rewrite the instructions
4. Re-runs the benchmark to verify the rewrite actually improved the score
5. Rejects rewrites that don't meet the minimum improvement threshold (quality gate)
6. Repeats until a stopping condition is met: score threshold, iteration limit, or cost ceiling
7. Writes the improved SKILL.md back to disk and appends a structured entry to `MEMORIES.md`

The key insight: SkillOpt treats `## Instructions` the way gradient descent treats model weights — as parameters that can be iteratively improved against a measurable objective.

**What it does NOT do:**
- Does not retrain any LLM model
- Does not modify `AGENTS.md`, `GATE.md`, `ROUTER.md`, or any logic component
- Does not run in production — it is a developer-side maintenance tool
- Does not require a server, database, or persistent backend
- Does not upload your files anywhere — all ingestion runs locally

---

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                      SKILL INGESTION                         │
│                                                              │
│  Source A: .zip package  → auto-extract all SKILL.md files   │
│  Source B: .md file      → direct load from file system      │
│  Source C: paste text    → copy-paste raw SKILL.md content   │
│  Source D: CLI --skill   → any path on disk                  │
│  Source E: CLI --package → Ai-Agent Builder .zip             │
│  Source F: CLI --scan    → recursive directory search        │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     OPTIMIZATION LOOP                        │
│                                                              │
│  1. Parse SKILL.md — validate structure, extract sections    │
│  2. Load golden set — partition into train / holdout         │
│  3. Baseline eval — LLM judge scores ## Instructions         │
│  4. FOR each iteration (up to max_iterations):               │
│     a. Optimizer model rewrites ## Instructions              │
│        based on observed failure cases                       │
│     b. Quality gate — reject if line count exceeded          │
│     c. Quality gate — reject if validate.sh fails            │
│     d. LLM judge scores the rewritten instructions           │
│     e. Quality gate — reject if Δscore < min_delta           │
│     f. Write accepted rewrite to SKILL.md                    │
│     g. Every 3 accepts — run holdout eval (overfit check)    │
│  5. Stop when: threshold reached / budget hit / max iter     │
│  6. Final holdout eval — confirm generalization              │
│  7. Write MEMORIES.md structured log entry                   │
│  8. Save baseline score to evals/golden-set/baselines/       │
└──────────────────────────────────────────────────────────────┘
```

**Model roles:**

| Role | Recommended Model | Purpose |
|------|-------------------|---------|
| Optimizer | `claude-opus-4-20250514` or `claude-sonnet-4-20250514` | Rewrites the `## Instructions` section using observed failures |
| Evaluator | `claude-sonnet-4-20250514` or `claude-haiku-4-5-20251001` | Runs the LLM judge, scores instructions against golden set |

The optimizer and evaluator are intentionally separate models to prevent self-reinforcing bias.

---

## Directory Structure

```
skillopt/
│
├── skillopt.html                   # Browser UI — open directly in any browser, zero server
│
├── js/
│   ├── app.js                      # Application state, Anthropic API client, run loop, renderer
│   └── skill-loader.js             # Unified skill ingestion: drag-drop, .zip extract, paste
│
├── scripts/
│   ├── skillopt.py                 # CLI optimization loop — main entry point
│   ├── eval-runner.py              # Standalone benchmark runner (single eval, no loop)
│   └── ingest.py                   # CLI skill ingestion: --skill, --package, --scan
│
├── .agents/
│   └── skills/                     # Default location for skill files to be optimized
│       └── rag-retrieval.md        # Example skill file (fully authored)
│
├── evals/
│   └── golden-set/                 # Benchmark datasets
│       ├── general.json            # General-purpose retrieval scenarios (24 scenarios)
│       ├── code-review.json        # Code review scenarios (18 scenarios)
│       └── baselines/              # Saved baseline scores (auto-populated after each run)
│
├── references/
│   └── llm-judge.md                # Scoring rubric: criteria weights, disqualifying patterns
│
├── config/
│   └── config.json                 # Default configuration — all values CLI-overridable
│
├── tests/
│   ├── test_skillopt.py            # 31 unit tests — SkillFile, GoldenSet, MemoriesLog, costs
│   └── test_ingest.py              # 45 unit tests — ingestion: direct, zip, scan, parsing
│
├── validate.sh                     # SKILL.md schema validator (called after each accepted rewrite)
├── requirements.txt                # Python dependencies (anthropic SDK only)
├── .env.example                    # Environment variable template
├── .gitignore                      # Excludes .bak.md files, secrets, Python cache
├── MEMORIES.md                     # Structured optimization log (auto-appended after each run)
└── README.md                       # This file
```

---

## Quick Start

### Prerequisites

- Python 3.9 or higher
- An [Anthropic API key](https://console.anthropic.com)
- A SKILL.md file to optimize (from Ai-Agent Builder or your own workflow)
- A golden set JSON file (see [Golden Set Format](#golden-set-format))

### Install

```bash
# Clone or download the project
git clone https://github.com/david-spies/skillopt.git
cd skillopt

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows

# Install Python dependency (only the Anthropic SDK is required)
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# If NOT using a virtual environment — set your API key directly
export ANTHROPIC_API_KEY="sk-ant-..."

# Anthropic API key can also be entered in the browser UI:
#   Open skillopt.html → click Settings (gear icon, top right)
#   Key is stored in localStorage only — never sent to any server except api.anthropic.com
```

### Load Your Skill File

Before running an optimization, you need to get your SKILL.md into SkillOpt. See the full [Loading a Skill File](#loading-a-skill-file) section for all options. The fastest paths:

```bash
# From Ai-Agent Builder .zip — auto-extracts, no manual unpacking
python scripts/ingest.py --package ~/Downloads/my-agent.zip

# From any path on disk
python scripts/ingest.py --skill path/to/my-skill.md

# Scan an entire project directory
python scripts/ingest.py --scan ./my-agents/
```

Or open `skillopt.html` in your browser and drag-and-drop the `.zip` or `.md` file onto the **Load Skill** panel.

### Run Your First Optimization

```bash
python scripts/skillopt.py \
    --skill .agents/skills/rag-retrieval.md \
    --golden-set evals/golden-set/general.json \
    --iterations 10 \
    --budget 3.00
```

### Open the Browser UI

```bash
open skillopt.html
# Windows: start skillopt.html
# Or: double-click skillopt.html in Finder / File Explorer
```

No server required. The UI runs entirely in your browser. Without an API key it runs in **simulation mode** — the full optimization loop animates without making real API calls, so you can explore the interface first.

---

## Loading a Skill File

This is the most important operational detail: **SkillOpt does not assume any fixed file location.** A SKILL.md can come from anywhere — the Ai-Agent Builder, another workflow, a teammate, a git repo — and SkillOpt provides a dedicated ingestion layer for every source.

### The Three Sources

```
┌─────────────────────────────────────────────────────────────────┐
│  SOURCE 1: Ai-Agent Builder .zip package                        │
│                                                                 │
│  When you click "Build Agent" in the builder, you download a    │
│  .zip containing SKILL.md, AGENTS.md, guardrails, and README.   │
│                                                                 │
│  SkillOpt accepts that .zip directly. It extracts all           │
│  SKILL.md files automatically — no unzipping, no copying,       │
│  no path configuration required.                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  SOURCE 2: Any .md file on your file system                     │
│                                                                 │
│  A SKILL.md from any workflow — hand-authored, from another     │
│  tool, from a git repo clone, from a teammate — can be loaded   │
│  by dropping it into the browser UI or passing --skill <path>   │
│  on the CLI. No fixed directory assumption.                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  SOURCE 3: Paste raw content                                    │
│                                                                 │
│  Copy the contents of a SKILL.md from a GitHub web UI,          │
│  a remote terminal, or a colleague's message. Paste it into     │
│  the browser UI "paste text" tab or pipe it to the CLI.         │
└─────────────────────────────────────────────────────────────────┘
```

### Browser UI — Load Skill Panel

Open `skillopt.html` and click **Load Skill** (top of the sidebar, highlighted in green). Three tabs:

**Drop / Open tab**
- Drag-and-drop a `.md` or `.zip` file onto the drop zone, or click to open a file picker
- Accepts multiple files simultaneously
- `.zip` files are extracted entirely in the browser — no server, no upload
- All SKILL.md files inside the package are found, parsed, and listed
- If the package contains only one skill, it auto-activates
- If multiple skills are found, a selection list appears — click any to set it as active
- The package's golden set JSON files (if present) are surfaced with a copy command

After loading, the skill appears in the **loaded skills** list with:
- Validation status (green = valid, yellow = warnings, red = errors)
- Line count, version, and source label
- A preview of the `## Instructions` section
- Buttons to set as active or set active and immediately start the optimizer

The active skill is automatically injected into the **Run Optimizer → config → target skill** dropdown. Navigate to Run Optimizer and the skill is already selected.

**Paste tab**
- Paste raw SKILL.md content directly into the text area
- Assign a filename for identification
- Click **load from paste** — the skill is parsed, validated, and added to the loaded list

**How it works tab**
- Explains all three ingestion paths with examples
- Shows the CLI equivalents for every operation

### CLI — `scripts/ingest.py`

```bash
# Direct path — any location on disk
python scripts/ingest.py --skill path/to/any/SKILL.md

# Ai-Agent Builder .zip package — auto-extracts all SKILL.md files
python scripts/ingest.py --package ~/Downloads/my-agent.zip

# Scan a directory — recursive search, interactive selection menu
python scripts/ingest.py --scan ./my-agents/

# Scan + select all + auto-optimize (full pipeline, one command)
python scripts/ingest.py \
    --scan ./my-agents/ \
    --all \
    --auto-optimize \
    --golden-set evals/golden-set/general.json \
    --budget 3.00

# Package + auto-optimize (most common Ai-Agent Builder workflow)
python scripts/ingest.py \
    --package ~/Downloads/my-agent.zip \
    --auto-optimize \
    --golden-set evals/golden-set/general.json \
    --iterations 10 \
    --budget 2.00
```

**`ingest.py` flags:**

| Flag | Description |
|------|-------------|
| `--skill PATH` | Direct path to a single SKILL.md |
| `--package ZIP` | Path to an Ai-Agent Builder `.zip` package |
| `--scan DIR` | Recursively scan a directory for SKILL.md files |
| `--max-depth N` | Max scan depth (default: 6) |
| `--all` | With `--scan`: select all found skills without prompting |
| `--auto-optimize` | Chain directly into `skillopt.py` after ingestion |
| `--list-only` | List found skills without prompting or optimizing |

All `skillopt.py` flags (`--golden-set`, `--iterations`, `--budget`, `--opt-model`, etc.) are accepted by `ingest.py` and passed through to the optimizer when `--auto-optimize` is set.

### Skill Validation on Load

Every skill is validated immediately on load, regardless of source. Validation checks:

| Check | Severity | Description |
|-------|----------|-------------|
| `## Instructions` section present | Error | Required for optimization |
| `## Input`, `## Output` sections | Error | Required structure |
| `name:` and `description:` fields | Error | Required header fields |
| `## Examples` section | Warning | Recommended |
| Description length 20–300 chars | Warning | Short descriptions reduce activation |
| Line count ≤ 200 | Error | Hard limit enforced by quality gate |
| No hardcoded secrets | Error | Checked by `validate.sh` |

Skills with errors are loaded but flagged — they will be rejected by the quality gate if they don't pass `validate.sh`.

---

## Browser UI

Open `skillopt.html` in any modern browser. No installation, no server.

### Panels

**Load Skill** *(start here)*
The entry point. Three ingestion methods — drag-and-drop `.md`/`.zip`, paste raw content, or review how it works. Skills loaded here are automatically available in the optimizer config. See [Loading a Skill File](#loading-a-skill-file) for full details.

**Run Optimizer**
Configure and launch an optimization run. Three tabs:

- **config** — select target skill (auto-populated from Load Skill), choose golden set, set optimizer and evaluator models, configure iterations, budget ceiling, score threshold, minimum delta, max line count, holdout split percentage, git backup toggle, and validation toggle
- **live run** — real-time terminal output, animated progress bar, four live metrics (current score, iteration, accepted rewrites, cost so far), and a running log of every accept/reject decision
- **results** — per-iteration breakdown table showing before score, after score, delta, verdict, what changed in the rewrite, and per-iteration cost

**Golden Set Manager**
Manage your benchmark dataset. Three tabs:

- **view scenarios** — browse all scenarios with visual score bars and holdout partition badges; filter by pass/fail/holdout
- **add scenarios** — upload a `.json` file or add individual scenarios manually with input, expected output, target file, and partition selection
- **dataset health** — scenario counts per file, pass rate, score distribution histogram, and specific recommendations (minimum count warnings, ambiguous ground truth flags, holdout split status)

**Run History**
All past optimization runs stored in `localStorage`. Shows before/after scores, iteration counts, accepted/rejected ratio, and total cost per run. The **by skill** tab displays a progress bar per skill file with best score and run count.

**Diff Viewer**
Line-level diff of the `## Instructions` section between versions. Green lines are additions, red lines are removals, gray lines are unchanged context. The **version history** tab lists all saved versions with restore buttons — click to roll back to any previous state.

**Cost Tracker**
Total API spend across all runs, average cost per run, average cost per iteration, and a cost-per-score-point efficiency metric. Full cost log by run with skill name, iteration count, accepted rewrites, and delta score.

### Settings

Click the gear icon (top right) to configure:

- **Anthropic API key** — stored in `localStorage` only, never sent anywhere except `api.anthropic.com`
- **Skills base path** — default path for skill files (`.agents/skills/`)
- **MEMORIES.md path** — where the optimization log is written

**Simulation mode:** Without an API key, the UI runs in simulation mode. The full optimization loop animates with realistic timing and randomized accept/reject decisions — no API calls, no cost. Use it to explore the interface before connecting your key.

---

## CLI Usage

### `scripts/ingest.py` — Skill Ingestion

The recommended first step for any CLI workflow. Handles all source types and optionally chains into the optimizer.

```bash
# Locate and display skills without running anything
python scripts/ingest.py --skill my-skill.md --list-only
python scripts/ingest.py --scan ./agents/ --list-only

# Load from zip, then show CLI command to run optimizer
python scripts/ingest.py --package ~/Downloads/agent.zip

# Full pipeline: package → extract → optimize
python scripts/ingest.py \
    --package ~/Downloads/agent.zip \
    --auto-optimize \
    --golden-set evals/golden-set/general.json \
    --iterations 10 \
    --budget 2.00 \
    --opt-model claude-opus-4-20250514 \
    --eval-model claude-haiku-4-5-20251001
```

### `scripts/skillopt.py` — Optimization Loop

The core CLI optimizer. Accepts a skill path and runs the full optimization loop.

```bash
python scripts/skillopt.py --skill <path> [options]
```

**All flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--skill` | *(required)* | Path to the target SKILL.md file |
| `--golden-set` | `evals/golden-set/general.json` | Path to golden set JSON |
| `--opt-model` | `claude-sonnet-4-20250514` | Optimizer model (rewrites instructions) |
| `--eval-model` | `claude-sonnet-4-20250514` | Evaluator model (runs LLM judge) |
| `--iterations` | `10` | Max optimization iterations |
| `--budget` | `3.00` | Hard API cost ceiling in USD |
| `--threshold` | `4.8` | Stop early if this score is reached |
| `--min-delta` | `0.05` | Min score improvement to accept a rewrite |
| `--max-lines` | `200` | Max line count for `## Instructions` |
| `--holdout` | `20.0` | % of scenarios withheld from optimization |
| `--memories` | `MEMORIES.md` | Path to optimization log |
| `--baselines-dir` | `evals/golden-set/baselines` | Where to save baseline scores |
| `--api-key` | `""` | Override `ANTHROPIC_API_KEY` env var |
| `--no-git` | `false` | Skip `.bak.md` backup before writing |
| `--no-validate` | `false` | Skip `validate.sh` after each write |
| `--dry-run` | `false` | Run without writing any files to disk |

**Common patterns:**

```bash
# Standard run — balanced quality and cost
python scripts/skillopt.py \
    --skill .agents/skills/rag-retrieval.md \
    --golden-set evals/golden-set/general.json

# High quality — Opus optimizer, Haiku evaluator (best results, lower cost than Opus+Sonnet)
python scripts/skillopt.py \
    --skill .agents/skills/code-review.md \
    --opt-model claude-opus-4-20250514 \
    --eval-model claude-haiku-4-5-20251001 \
    --iterations 15 \
    --budget 5.00

# Quick cheap test — verify everything works before a full run
python scripts/skillopt.py \
    --skill .agents/skills/sprint-planning.md \
    --eval-model claude-haiku-4-5-20251001 \
    --iterations 3 \
    --budget 0.50

# Dry run — analyze without writing any files
python scripts/skillopt.py \
    --skill .agents/skills/rag-retrieval.md \
    --dry-run

# Re-optimize with a specific golden set partition
python scripts/skillopt.py \
    --skill .agents/skills/security-audit.md \
    --golden-set evals/golden-set/security.json \
    --holdout 25 \
    --threshold 4.5
```

### `scripts/eval-runner.py` — Standalone Benchmark

Run a single evaluation without the optimization loop. Useful for checking current score, comparing against a saved baseline, or validating a manually edited SKILL.md.

```bash
# Score the current skill
python scripts/eval-runner.py \
    --skill .agents/skills/rag-retrieval.md \
    --golden-set evals/golden-set/general.json

# Compare against a saved baseline
python scripts/eval-runner.py \
    --skill .agents/skills/rag-retrieval.md \
    --golden-set evals/golden-set/general.json \
    --compare-baseline evals/golden-set/baselines/rag-retrieval_20250529_120000.json

# Save result as new baseline
python scripts/eval-runner.py \
    --skill .agents/skills/rag-retrieval.md \
    --golden-set evals/golden-set/general.json \
    --save-baseline

# Evaluate only the holdout partition (overfitting check)
python scripts/eval-runner.py \
    --skill .agents/skills/rag-retrieval.md \
    --golden-set evals/golden-set/general.json \
    --partition holdout

# Write full JSON result to file
python scripts/eval-runner.py \
    --skill .agents/skills/rag-retrieval.md \
    --golden-set evals/golden-set/general.json \
    --output results/latest-eval.json
```

**`eval-runner.py` flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--skill` | *(required)* | Path to SKILL.md |
| `--golden-set` | *(required)* | Path to golden set JSON |
| `--model` | `claude-sonnet-4-20250514` | Judge model |
| `--compare-baseline` | `""` | Path to a saved baseline JSON to compare against |
| `--save-baseline` | `false` | Save this result as a new baseline |
| `--output` | `""` | Write JSON result to this path |
| `--partition` | `all` | `all`, `train`, or `holdout` |
| `--api-key` | `""` | Override `ANTHROPIC_API_KEY` |

### `validate.sh` — Schema Validator

```bash
bash validate.sh .agents/skills/rag-retrieval.md
```

Validates required fields, required sections, line count, description length, and presence of hardcoded secrets. Called automatically by `skillopt.py` after each accepted rewrite unless `--no-validate` is passed. Exit code `0` = valid, `1` = errors found.

---

## Golden Set Format

A golden set is a JSON array of test scenarios. Each scenario defines an input, the expected correct output, and how it should be scored.

### Minimal Schema

```json
[
  {
    "id": 1,
    "query": "The input or user query being tested",
    "expected_output": "Description of what a correct response looks like",
    "partition": "train"
  }
]
```

### Full Schema

```json
[
  {
    "id": 1,
    "query": "Retrieve context for OAuth authentication flows",
    "expected_output": "Return 3–5 chunks with source paths, confidence scores ≥ 0.7, and line ranges",
    "criteria": [
      "relevance ranking present",
      "source path included",
      "confidence score ≥ 0.7",
      "line range included"
    ],
    "partition": "train",
    "weight": 1.5
  }
]
```

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique integer identifier |
| `query` | yes | The test input — a user query, task description, or code snippet |
| `expected_output` | yes | Ground truth — what a correct response looks like |
| `criteria` | no | Specific sub-checks the judge should verify — improves scoring precision |
| `partition` | no | `"train"` (used in optimization) or `"holdout"` (overfitting check only). Defaults to `"train"`. |
| `weight` | no | Relative importance multiplier (default: 1.0). Higher = more influence on final score. |

### Partition Strategy

| Partition | Role | Recommended % |
|-----------|------|---------------|
| `train` | Active optimization — judge scores these each iteration | 80% |
| `holdout` | Generalization check — never seen by optimizer | 20% |

If no `partition` field is present, SkillOpt auto-splits based on the `--holdout` percentage (default 20%).

### Scenario Count Guidelines

| Count | Risk | Recommendation |
|-------|------|----------------|
| < 10 | Very high | Do not run optimizer — results will overfit severely |
| 10–14 | High | Possible but risky — expand before optimizing |
| 15–24 | Moderate | Sufficient for initial optimization — expand when possible |
| 25+ | Low | Recommended floor for production-quality results |
| 50+ | Minimal | Robust optimization with reliable holdout signal |

### Writing Good Scenarios

Every scenario should come from a real task your agent has encountered or is likely to encounter.

**Good scenarios:**
- Based on actual user requests that produced incorrect outputs from your deployed agent
- Include edge cases — empty inputs, ambiguous queries, adversarial inputs, access control cases
- Have unambiguous `expected_output` descriptions — the LLM judge needs clear ground truth
- Cover the full range of difficulty, not just easy happy-path cases

**Avoid:**
- Scenarios so easy the skill would pass on day one (no optimization signal)
- Ambiguous expected outputs that a reasonable person could interpret two ways
- Scenarios that test the LLM's world knowledge rather than skill behavior
- Scenarios copied from the same source — diversity matters

---

## SKILL.md Format

SkillOpt only modifies the `## Instructions` section of a SKILL.md file. All other sections are read for context but never written.

### Required Structure

```markdown
name: my-skill
description: Clear, specific description of what this skill does (20–300 chars)
version: 1.0.0
author: ai-agent-builder

---

## Instructions

(SkillOpt reads and rewrites this section only)

## Input

What inputs the skill accepts, including type and format.

## Output

What the skill returns, including schema.

## Examples

Concrete input → output pairs.

## on_fail

retry_count: 1
fallback: return_empty_with_explanation

## Notes

Human-readable context, optimization history notes.
```

### Rules for `## Instructions`

- **Max 200 lines** — enforced by `validate.sh` and the quality gate; rewrites exceeding this are auto-rejected
- **Model-agnostic** — no references to specific LLMs by name
- **Procedural** — describe what the skill should *do*, step by step
- **Concrete** — numeric thresholds, specific criteria, named conditions; avoid vague language like "be thorough"
- **English** — the optimizer model is English-language

### The `description:` Field

The description field controls when your agent activates this skill. It is **not** optimized by default because over-optimizing it for benchmark score can make it more technical and less likely to match natural user phrasing.

To enable description optimization: `--opt-description yes` (CLI) or toggle in the browser UI config. Use with caution and always check activation rates in production after changing it.

---

## Configuration

Default values live in `config/config.json`. All values can be overridden with CLI flags.

```json
{
  "models": {
    "optimizer": "claude-sonnet-4-20250514",
    "evaluator": "claude-haiku-4-5-20251001",
    "optimizer_high_quality": "claude-opus-4-20250514"
  },
  "loop": {
    "default_iterations": 10,
    "default_budget_usd": 3.00,
    "default_score_threshold": 4.8,
    "min_delta_to_accept": 0.05,
    "holdout_percentage": 20,
    "holdout_check_every_n_accepts": 3
  },
  "quality_gate": {
    "max_instruction_lines": 200,
    "min_training_scenarios": 15,
    "overfit_gap_warning": 0.5,
    "run_validate_sh": true,
    "auto_git_backup": true
  },
  "paths": {
    "skills_dir": ".agents/skills",
    "golden_set_dir": "evals/golden-set",
    "baselines_dir": "evals/golden-set/baselines",
    "memories_file": "MEMORIES.md",
    "validate_script": "validate.sh"
  }
}
```

### Environment Variables

Copy `.env.example` to `.env` and edit before running:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

The `.env` file is loaded automatically by `skillopt.py` and `eval-runner.py`. It is listed in `.gitignore` and will never be committed. The API key can also be passed with `--api-key` or set with `export ANTHROPIC_API_KEY=...`.

---

## Cost Management

SkillOpt makes real API calls. Approximate cost per iteration by model combination:

| Optimizer | Evaluator | Cost / iteration | 10 iterations | Best for |
|-----------|-----------|-----------------|---------------|----------|
| Opus | Sonnet | ~$0.38–0.52 | ~$4–5 | Maximum quality, critical skills |
| Sonnet | Sonnet | ~$0.14–0.20 | ~$1.5–2 | Balanced — good default |
| Sonnet | Haiku | ~$0.07–0.11 | ~$0.75–1 | **Recommended for most users** |
| Haiku | Haiku | ~$0.02–0.04 | ~$0.25–0.40 | Quick tests, early iteration |

**Recommended approach:** Sonnet optimizer + Haiku evaluator. The evaluator runs on every iteration and is the primary cost driver. Haiku is fast and inexpensive for scoring. Reserve Opus for your most critical production skills.

**Budget ceiling:** The `--budget` flag is a hard stop. The loop halts immediately when cumulative cost reaches the ceiling — even mid-iteration. No overrun is possible.

**Before committing to a full run:**

```bash
# Dry run — shows the full loop output without spending anything
python scripts/skillopt.py \
    --skill .agents/skills/rag-retrieval.md \
    --dry-run

# Short test run — 3 iterations, $0.50 ceiling
python scripts/skillopt.py \
    --skill .agents/skills/rag-retrieval.md \
    --eval-model claude-haiku-4-5-20251001 \
    --iterations 3 \
    --budget 0.50
```

**Cost tracking:** The browser UI Cost Tracker panel shows total spend, average per run, average per iteration, and a cost-per-score-point efficiency metric across all historical runs.

---

## Quality Gate

Every proposed rewrite passes through a four-stage quality gate before being written to disk. A rewrite is rejected — and the current (working) instructions are kept — if it fails any stage.

```
Stage 1: Line count
  → Rewrite must not exceed max_lines (default: 200)
  → Rejected rewrites are logged but never written

Stage 2: Schema validation
  → validate.sh runs against a temp copy of the rewritten skill
  → Checks required sections, fields, encoding, and secrets
  → Skipped if --no-validate is set

Stage 3: Score improvement
  → LLM judge scores the rewritten instructions against the training set
  → Score must exceed the current score by at least min_delta (default: 0.05)
  → A rewrite that scores the same or lower is always rejected

Stage 4: Holdout parity (every 3 accepted rewrites)
  → The current instructions are scored against the holdout set
  → If train score − holdout score > overfit_gap_warning (default: 0.5),
    a warning is printed
  → Does not reject the rewrite, but signals overfitting risk
```

**Automatic backup:** Before the first accepted write in any run, the original SKILL.md is copied to `skill-name.YYYYMMDD_HHMMSS.bak.md`. Disable with `--no-git`.

**Rollback:** The Diff Viewer panel in the browser UI lists all saved versions with one-click restore. On the CLI, copy the `.bak.md` file back over the original manually.

---

## Run History and MEMORIES.md

After each optimization run, SkillOpt appends a structured JSON entry to `MEMORIES.md`. This turns the file into a queryable training history — agents can read it to understand why instructions are written the way they are.

```json
{
  "skill": "rag-retrieval.md",
  "run_date": "2025-05-29T14:23:01",
  "baseline_score": 3.62,
  "final_score": 4.41,
  "improvement": 0.79,
  "holdout_score": 4.28,
  "iterations": 10,
  "accepted": 4,
  "rejected": 6,
  "total_cost_usd": 1.84,
  "opt_model": "claude-sonnet-4-20250514",
  "eval_model": "claude-haiku-4-5-20251001",
  "backup": ".agents/skills/rag-retrieval.20250529_142301.bak.md",
  "iter_log": [
    {
      "iter": 1,
      "before": 3.62,
      "after": 3.89,
      "delta": 0.27,
      "verdict": "accepted",
      "time_s": 8.4,
      "cost": 0.0182
    },
    {
      "iter": 2,
      "before": 3.89,
      "after": 3.83,
      "delta": -0.06,
      "verdict": "rejected",
      "time_s": 7.1,
      "cost": 0.0164
    }
  ]
}
```

`MEMORIES.md` is append-only. Do not edit entries manually. The browser UI Run History panel reads and displays all entries with sorting and filtering.

---

## Testing

The test suite has **76 tests across two files**, covering all core logic with no external API calls.

```bash
# Activate virtual environment first
source .venv/bin/activate

# Run all tests
python -m pytest tests/ -v

# Run with coverage report
python -m pytest tests/ --cov=scripts --cov-report=term-missing

# Run only the core optimizer tests (31 tests)
python -m pytest tests/test_skillopt.py -v

# Run only the ingestion tests (45 tests)
python -m pytest tests/test_ingest.py -v

# Run a specific test class
python -m pytest tests/test_skillopt.py::TestSkillFile -v
python -m pytest tests/test_ingest.py::TestIngestPackage -v

# Run a single test
python -m pytest tests/test_ingest.py::TestIngestPackage::test_extracts_multiple_skills -v
```

**`tests/test_skillopt.py` — 31 tests:**

| Class | Tests | Covers |
|-------|-------|--------|
| `TestSkillFile` | 9 | Load, parse, replace instructions, write, backup, error on missing |
| `TestGoldenSet` | 6 | Load, explicit partitions, auto-split, missing file, non-array |
| `TestMemoriesLog` | 4 | Append, accumulate, append to existing file |
| `TestBaselineSaver` | 3 | Save, directory creation, filename format |
| `TestEstimateCost` | 5 | Model pricing, linear scaling, zero tokens, unknown model |
| `TestRoundTrip` | 4 | Full write → reload → restore integration cycle |

**`tests/test_ingest.py` — 45 tests:**

| Class | Tests | Covers |
|-------|-------|--------|
| `TestIsSkillFile` | 6 | Valid, minimal, invalid, empty, edge cases |
| `TestExtractSkillMeta` | 9 | All fields, line count, inst lines, missing fields |
| `TestIngestDirect` | 7 | Valid load, missing file, invalid skill, path resolution, meta |
| `TestIngestPackage` | 12 | Single skill, multi-skill, source label, zip entry, mac metadata, invalid zip, custom extract dir |
| `TestIngestScan` | 11 | Recursive find, non-skill exclusion, `.agents/` inclusion, hidden dir exclusion, max depth, empty dir, rel path |

---

## Workflow: Builder → SkillOpt

SkillOpt is a post-deployment maintenance tool. The two tools have a clean, non-overlapping division of responsibility.

```
┌───────────────────────────────────────────────────────────────┐
│                  TOOL 1: Ai-Agent Builder                     │
│                  browser-based, one-time per agent            │
│                                                               │
│  • Define agent name, use case, template                      │
│  • Upload reference files                                     │
│  • Configure logic components (ROUTER, GATE, etc.)            │
│  • Set feature flags and on_fail behavior                     │
│  • Click "Build Agent" → download .zip package                │
│                                                               │
│  OUTPUT: SKILL.md + AGENTS.md + guardrails.md                 │
│          + logic components + README.md                       │
└─────────────────────────────┬─────────────────────────────────┘
                              │
                              │  Download .zip
                              │  Deploy agent to production
                              │  Agent runs real tasks for 2–4 weeks
                              │  Failure cases accumulate
                              │  Add failures to evals/golden-set/
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                  TOOL 2: SkillOpt                             │
│                  CLI or browser UI, on demand                 │
│                                                               │
│  INGEST:                                                      │
│  • Drop .zip into browser UI  → auto-extract SKILL.md         │
│  • python ingest.py --package → extract + optimize            │
│  • python ingest.py --scan    → find all skills in project    │
│                                                               │
│  OPTIMIZE:                                                    │
│  • Run against accumulated golden set                         │
│  • Optimizer rewrites ## Instructions                         │
│  • Quality gate accepts / rejects each rewrite                │
│  • Holdout eval checks for overfitting                        │
│  • Improved SKILL.md written back to disk                     │
│                                                               │
│  OUTPUT: Improved SKILL.md (same file, improved instructions) │
│          + MEMORIES.md structured log entry                   │
│          + .bak.md backup of previous version                 │
│          + baseline score saved to evals/golden-set/baselines │
└───────────────────────────────────────────────────────────────┘
```

**What SkillOpt never touches:**
- `AGENTS.md` — agent configuration and routing
- `GATE.md`, `ROUTER.md` — logic components
- `guardrails.md` — safety and permission rules
- `README.md` — package documentation
- Any other file in the agent package not explicitly listed above

**When to run SkillOpt:**
- Agent has been running 2–4 weeks and real failure cases are available in the golden set
- Agent's eval score on new scenarios has dropped below 4.0
- You've added new scenarios to the golden set and want the skill to cover them
- You're deploying to a new environment and want to re-optimize for that context

**How often:** Periodically — not continuously. SkillOpt is not a runtime component. Think of it like retraining a model: you run it when new data has accumulated, not on every request.

---

## FAQ

**Q: Do I need to manually copy my SKILL.md into a specific folder before using SkillOpt?**
No. SkillOpt has no fixed file location assumption. You can drop the Ai-Agent Builder `.zip` directly into the browser UI and it auto-extracts the SKILL.md. On the CLI, pass any path with `--skill path/to/anything.md` or use `--package` or `--scan`. See [Loading a Skill File](#loading-a-skill-file).

**Q: Does SkillOpt upload my files anywhere?**
No. All file ingestion — including ZIP extraction — runs entirely locally. In the browser, ZIP files are parsed using a built-in JavaScript ZIP reader that never leaves the browser tab. On the CLI, everything runs on your machine. The only external calls are to `api.anthropic.com` for the optimizer and evaluator LLM calls.

**Q: Does SkillOpt modify my AGENTS.md or other logic components?**
No. SkillOpt only writes to the `## Instructions` section of the specific SKILL.md you target, appends to `MEMORIES.md`, and saves scores to `evals/golden-set/baselines/`. Every other file is strictly read-only.

**Q: What if a run makes my skill worse?**
It can't — the quality gate enforces a minimum score improvement before accepting any rewrite. Additionally, before the first accepted write, SkillOpt creates a timestamped `.bak.md` backup. You can restore it manually anytime. The browser Diff Viewer also provides one-click rollback to any previous version.

**Q: Can I run it against a skill the builder didn't create?**
Yes. Any `.md` file containing `## Instructions`, `name:`, and `description:` fields is valid. SkillOpt does not care how the file was created. See [SKILL.md Format](#skillmd-format).

**Q: How many scenarios do I need before running?**
Minimum 15 training scenarios. Fewer than that and the optimizer is likely to overfit to those specific cases. 25+ is the recommended floor for production skills, 50+ for high-stakes optimization.

**Q: Will the same optimization run produce the same result twice?**
No. LLMs are non-deterministic. Two runs on the same skill with the same golden set will produce different rewrites and potentially different final scores. Running multiple times and comparing results in the Run History panel is a valid strategy for finding the best outcome.

**Q: Can I use a local or self-hosted LLM instead of Anthropic?**
The `LLMJudge` and `Optimizer` classes in `skillopt.py` use the Anthropic SDK directly. To use another provider, replace those two classes with calls to your preferred API. The optimization loop, quality gate, ingestion, and all other logic are completely provider-agnostic.

**Q: Can SkillOpt optimize the `description:` field?**
Yes, but it is off by default. Use `--opt-description yes` (CLI) or the toggle in the browser config tab. Use with caution: descriptions optimized purely for benchmark score can become more technical and less likely to match the natural language users actually type. The description optimizer uses a separate objective function focused on activation precision rather than raw score.

**Q: What's the difference between the browser UI and the CLI?**
Both use the same Anthropic API and implement the same optimization logic. The browser UI is the interactive control plane — best for loading skills, running monitored optimization sessions, reviewing diffs, and exploring history. The CLI is automation-friendly — best for scripting, CI/CD integration, running on remote machines, or batch-optimizing multiple skills. The CLI is the authoritative implementation; the browser UI mirrors its behavior.

**Q: Can I run SkillOpt in CI/CD?**
Yes. Set `ANTHROPIC_API_KEY` as a CI secret and run:
```bash
python scripts/ingest.py \
    --skill .agents/skills/my-skill.md \
    --auto-optimize \
    --golden-set evals/golden-set/general.json \
    --iterations 5 \
    --budget 1.00 \
    --no-git
```
The exit code is `0` if the final score exceeds the baseline, `1` otherwise — making it compatible with standard CI pass/fail gates.

---

## License

MIT — see `LICENSE` for details.
