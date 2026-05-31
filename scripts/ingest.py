#!/usr/bin/env python3
"""
SkillOpt — scripts/ingest.py
Skill file ingestion: locate and load SKILL.md from any source.

Three modes:
  --skill  PATH    Direct path (single file) — identical to skillopt.py --skill
  --package ZIP    Ai-Agent Builder .zip output — auto-extracts all SKILL.md files
  --scan   DIR     Scan a directory recursively for SKILL.md files, present menu

After locating the skill(s), optionally chains directly into skillopt.py.

Usage:
  # Point directly at a file
  python scripts/ingest.py --skill path/to/SKILL.md

  # Extract from Ai-Agent Builder .zip
  python scripts/ingest.py --package ~/Downloads/agent-package.zip

  # Scan a directory
  python scripts/ingest.py --scan ./my-agents/

  # Scan + auto-optimize all found skills
  python scripts/ingest.py --scan ./my-agents/ --auto-optimize \
      --golden-set evals/golden-set/general.json \
      --budget 3.00
"""

import argparse
import os
import re
import sys
import subprocess
import tempfile
import zipfile
from pathlib import Path


# ─────────────────────────────────────────────────────────
# ANSI helpers
# ─────────────────────────────────────────────────────────
GRN = "\033[92m"; YLW = "\033[93m"; RED = "\033[91m"
BLU = "\033[94m"; GRY = "\033[90m"; WHT = "\033[97m"
BLD = "\033[1m";  RST = "\033[0m"

def ok(m):   print(f"{GRN}✓{RST} {m}")
def info(m): print(f"{BLU}→{RST} {m}")
def warn(m): print(f"{YLW}⚠{RST} {m}")
def err(m):  print(f"{RED}✗{RST} {m}")
def dim(m):  print(f"{GRY}{m}{RST}")
def bold(m): print(f"{BLD}{m}{RST}")


# ─────────────────────────────────────────────────────────
# SKILL FILE VALIDATOR (lightweight, no anthropic import)
# ─────────────────────────────────────────────────────────
def is_skill_file(text: str) -> bool:
    """
    Check: does this .md file look like a SKILL.md?
    Requires BOTH a ## Instructions section heading AND at least one
    YAML-style header field (name: or description:) at the start of a line.
    """
    has_instructions = bool(re.search(r'^## Instructions\s*$', text, re.MULTILINE))
    has_header_field = bool(re.search(r'^(?:name|description)\s*:\s*\S', text, re.MULTILINE))
    return has_instructions and has_header_field


def extract_skill_meta(text: str) -> dict:
    """Extract name, description, version from a SKILL.md string."""
    def _field(f):
        m = re.search(rf'^{f}\s*:\s*(.+)$', text, re.MULTILINE)
        return m.group(1).strip() if m else ''

    instructions_match = re.search(
        r'^## Instructions\s*\n([\s\S]*?)(?=\n## |\Z)', text, re.MULTILINE
    )
    instructions = instructions_match.group(1).strip() if instructions_match else ''

    return {
        'name':         _field('name'),
        'description':  _field('description'),
        'version':      _field('version'),
        'author':       _field('author'),
        'line_count':   len(text.splitlines()),
        'inst_lines':   len(instructions.splitlines()) if instructions else 0,
        'has_input':    '## Input' in text,
        'has_output':   '## Output' in text,
        'has_examples': '## Examples' in text,
    }


# ─────────────────────────────────────────────────────────
# INGESTION — DIRECT PATH
# ─────────────────────────────────────────────────────────
def ingest_direct(path: str) -> list:
    """
    Load a single SKILL.md from an absolute or relative path.
    Returns: [{'path': Path, 'text': str, 'meta': dict}]
    """
    p = Path(path).expanduser().resolve()
    if not p.exists():
        err(f"File not found: {p}")
        return []
    if not p.suffix == '.md':
        warn(f"File does not have .md extension: {p.name}")

    text = p.read_text(encoding='utf-8')
    if not is_skill_file(text):
        err(f"{p.name} does not appear to be a valid SKILL.md (missing ## Instructions)")
        return []

    meta = extract_skill_meta(text)
    ok(f"Loaded: {p.name}  ({meta['line_count']} lines, v{meta['version'] or '?'})")
    return [{'path': p, 'text': text, 'meta': meta, 'source': 'direct'}]


# ─────────────────────────────────────────────────────────
# INGESTION — ZIP PACKAGE (Ai-Agent Builder output)
# ─────────────────────────────────────────────────────────
def ingest_package(zip_path: str, extract_dir: str = None) -> list:
    """
    Extract all SKILL.md files from an Ai-Agent Builder .zip package.

    The Builder's zip structure is typically:
        agent-name/
          SKILL.md              ← what we want
          AGENTS.md
          guardrails.md
          README.md
          evals/
            golden-set/
              general.json      ← bonus: also extract this

    Returns: [{'path': Path, 'text': str, 'meta': dict, 'source': 'zip', 'zip_path': str}]
    """
    zp = Path(zip_path).expanduser().resolve()
    if not zp.exists():
        err(f"ZIP file not found: {zp}")
        return []
    if not zipfile.is_zipfile(zp):
        err(f"Not a valid ZIP file: {zp.name}")
        return []

    info(f"Extracting: {zp.name}")

    # Use a temp dir if no extract_dir specified
    own_tmpdir = extract_dir is None
    tmpdir     = Path(extract_dir) if extract_dir else Path(tempfile.mkdtemp(prefix='skillopt_'))

    found_skills = []
    found_golden = []

    with zipfile.ZipFile(zp, 'r') as zf:
        names = zf.namelist()
        dim(f"  {len(names)} files in archive")

        # Extract everything to tmpdir
        zf.extractall(tmpdir)

        # Find SKILL.md files
        for name in names:
            if name.endswith('/'):
                continue  # directory entry
            if '__MACOSX' in name or '.DS_Store' in name:
                continue  # Mac junk

            extracted = tmpdir / name
            if not extracted.exists():
                continue

            if extracted.suffix == '.md':
                try:
                    text = extracted.read_text(encoding='utf-8')
                except UnicodeDecodeError:
                    continue

                if is_skill_file(text):
                    meta = extract_skill_meta(text)
                    ok(f"  Found skill: {extracted.name}  "
                       f"({meta['line_count']} lines, v{meta['version'] or '?'})")
                    found_skills.append({
                        'path':     extracted,
                        'text':     text,
                        'meta':     meta,
                        'source':   'zip',
                        'zip_path': str(zp),
                        'zip_entry': name,
                    })

            elif extracted.suffix == '.json' and 'golden' in name.lower():
                found_golden.append(extracted)
                dim(f"  Found golden set: {extracted.name}")

    if not found_skills:
        err(f"No SKILL.md files found in {zp.name}")
        dim(f"  Files in archive:")
        for n in names[:20]:
            dim(f"    {n}")
        if len(names) > 20:
            dim(f"    ... and {len(names)-20} more")
        if own_tmpdir:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
        return []

    print()
    info(f"Extracted {len(found_skills)} skill(s) from {zp.name}")
    if found_golden:
        info(f"Also found {len(found_golden)} golden set file(s) — "
             f"copy to evals/golden-set/ to use them")
        for g in found_golden:
            dim(f"  cp \"{g}\" evals/golden-set/{g.name}")

    return found_skills


# ─────────────────────────────────────────────────────────
# INGESTION — DIRECTORY SCAN
# ─────────────────────────────────────────────────────────
def ingest_scan(directory: str, max_depth: int = 6) -> list:
    """
    Recursively scan a directory for SKILL.md files.
    Returns all found skills as a list.
    """
    root = Path(directory).expanduser().resolve()
    if not root.exists():
        err(f"Directory not found: {root}")
        return []
    if not root.is_dir():
        err(f"Not a directory: {root}")
        return []

    info(f"Scanning: {root}")

    found = []

    def _walk(path: Path, depth: int):
        if depth > max_depth:
            return
        try:
            for entry in sorted(path.iterdir()):
                if entry.name.startswith('.') and entry.name not in ('.agents',):
                    continue  # skip hidden dirs (except .agents which Builder uses)
                if entry.is_dir():
                    _walk(entry, depth + 1)
                elif entry.is_file() and entry.suffix == '.md':
                    try:
                        text = entry.read_text(encoding='utf-8')
                        if is_skill_file(text):
                            meta = extract_skill_meta(text)
                            found.append({
                                'path':   entry,
                                'text':   text,
                                'meta':   meta,
                                'source': 'scan',
                                'rel':    str(entry.relative_to(root)),
                            })
                    except (UnicodeDecodeError, PermissionError):
                        pass
        except PermissionError:
            pass

    _walk(root, 0)

    if not found:
        warn(f"No SKILL.md files found under {root}")
        dim("  (Looking for .md files containing ## Instructions and name:/description: headers)")
        return []

    print()
    ok(f"Found {len(found)} skill file(s):")
    for i, s in enumerate(found, 1):
        meta = s['meta']
        score_color = GRY
        print(f"  {GRY}{i:2}.{RST} {s['rel']:<45} "
              f"{GRY}v{meta['version'] or '?':<8}{RST} "
              f"{meta['line_count']:3} lines  "
              f"{GRY}{(meta['name'] or '')[:40]}{RST}")

    return found


# ─────────────────────────────────────────────────────────
# INTERACTIVE SELECTOR
# ─────────────────────────────────────────────────────────
def select_skills(skills: list, allow_multi: bool = False) -> list:
    """
    Present a numbered menu and return the user's selection.
    Returns a list of selected skill dicts.
    """
    if not skills:
        return []
    if len(skills) == 1:
        ok(f"Auto-selecting: {skills[0]['path'].name}")
        return skills

    print()
    if allow_multi:
        prompt = "Enter numbers to optimize (e.g. 1,3 or 'all'): "
    else:
        prompt = f"Select a skill to optimize [1–{len(skills)}]: "

    while True:
        try:
            choice = input(prompt).strip()
        except (KeyboardInterrupt, EOFError):
            print()
            sys.exit(0)

        if not choice:
            continue

        if allow_multi and choice.lower() == 'all':
            return skills

        try:
            indices = [int(x.strip()) - 1 for x in choice.split(',')]
            selected = [skills[i] for i in indices if 0 <= i < len(skills)]
            if selected:
                return selected
            else:
                err(f"Invalid selection. Enter 1–{len(skills)}.")
        except (ValueError, IndexError):
            err(f"Invalid input. Enter a number or comma-separated list.")


# ─────────────────────────────────────────────────────────
# CHAIN INTO skillopt.py
# ─────────────────────────────────────────────────────────
def run_skillopt(skill_path: str, extra_args: list) -> int:
    """
    Launch scripts/skillopt.py with the given skill path and extra args.
    Returns the exit code.
    """
    script = Path(__file__).parent / 'skillopt.py'
    cmd    = [sys.executable, str(script), '--skill', skill_path] + extra_args
    dim(f"\n$ {' '.join(cmd)}\n")
    result = subprocess.run(cmd)
    return result.returncode


# ─────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(
        prog='ingest',
        description='SkillOpt ingestion — locate SKILL.md from any source',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Direct path
  python scripts/ingest.py --skill path/to/SKILL.md

  # Ai-Agent Builder .zip package
  python scripts/ingest.py --package ~/Downloads/my-agent.zip

  # Directory scan with interactive selection
  python scripts/ingest.py --scan ./my-agents/

  # Scan + auto-optimize all skills found
  python scripts/ingest.py --scan ./my-agents/ --auto-optimize \\
      --golden-set evals/golden-set/general.json \\
      --iterations 10 --budget 3.00

  # Package + auto-optimize, no prompts
  python scripts/ingest.py \\
      --package ~/Downloads/my-agent.zip \\
      --auto-optimize \\
      --golden-set evals/golden-set/code-review.json
        """
    )

    # Source selection (mutually exclusive)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument('--skill',   metavar='PATH', help='Direct path to a SKILL.md file')
    src.add_argument('--package', metavar='ZIP',  help='Path to an Ai-Agent Builder .zip package')
    src.add_argument('--scan',    metavar='DIR',  help='Scan a directory recursively for SKILL.md files')

    # Scan options
    p.add_argument('--max-depth', type=int, default=6,
        help='Max directory scan depth (default: 6)')
    p.add_argument('--all', action='store_true',
        help='With --scan: optimize all found skills without prompting')

    # Optimization chaining
    p.add_argument('--auto-optimize', action='store_true',
        help='Automatically chain into skillopt.py after ingestion')
    p.add_argument('--list-only', action='store_true',
        help='Only list found skills, do not optimize or prompt')

    # skillopt.py passthrough flags
    p.add_argument('--golden-set',  default='evals/golden-set/general.json')
    p.add_argument('--opt-model',   default='claude-sonnet-4-20250514')
    p.add_argument('--eval-model',  default='claude-sonnet-4-20250514')
    p.add_argument('--iterations',  type=int,   default=10)
    p.add_argument('--budget',      type=float, default=3.00)
    p.add_argument('--threshold',   type=float, default=4.8)
    p.add_argument('--min-delta',   type=float, default=0.05)
    p.add_argument('--api-key',     default='')
    p.add_argument('--no-git',      action='store_true')
    p.add_argument('--dry-run',     action='store_true')

    args = p.parse_args()

    print()
    bold(f"SkillOpt — ingest.py")
    dim('─' * 44)
    print()

    # ── Ingest ──
    if args.skill:
        skills = ingest_direct(args.skill)
    elif args.package:
        skills = ingest_package(args.package)
    elif args.scan:
        skills = ingest_scan(args.scan, max_depth=args.max_depth)
    else:
        skills = []

    if not skills:
        sys.exit(1)

    if args.list_only:
        sys.exit(0)

    # ── Select ──
    if args.skill or len(skills) == 1:
        selected = skills
    elif args.all or args.auto_optimize and args.scan:
        selected = skills
    else:
        selected = select_skills(skills, allow_multi=bool(args.scan))

    if not selected:
        sys.exit(0)

    # ── Print selected ──
    print()
    if len(selected) == 1:
        ok(f"Selected: {selected[0]['path']}")
    else:
        ok(f"Selected {len(selected)} skills:")
        for s in selected:
            dim(f"  • {s['path']}")

    if not args.auto_optimize:
        # Just report — don't run optimizer
        print()
        info("To optimize, run:")
        for s in selected:
            print(f"  python scripts/skillopt.py --skill \"{s['path']}\" "
                  f"--golden-set {args.golden_set}")
        print()
        sys.exit(0)

    # ── Build skillopt passthrough args ──
    extra = [
        '--golden-set',  args.golden_set,
        '--opt-model',   args.opt_model,
        '--eval-model',  args.eval_model,
        '--iterations',  str(args.iterations),
        '--budget',      str(args.budget),
        '--threshold',   str(args.threshold),
        '--min-delta',   str(args.min_delta),
    ]
    if args.api_key:  extra += ['--api-key', args.api_key]
    if args.no_git:   extra += ['--no-git']
    if args.dry_run:  extra += ['--dry-run']

    # ── Run optimizer for each selected skill ──
    exit_codes = []
    for i, skill in enumerate(selected, 1):
        if len(selected) > 1:
            print()
            dim(f"─── Skill {i}/{len(selected)}: {skill['path'].name} ───")

        code = run_skillopt(str(skill['path']), extra)
        exit_codes.append(code)

    # Summary for multi-skill runs
    if len(selected) > 1:
        print()
        bold("─── Ingest summary ───")
        for skill, code in zip(selected, exit_codes):
            symbol = f"{GRN}✓{RST}" if code == 0 else f"{RED}✗{RST}"
            print(f"  {symbol} {skill['path'].name}")

    sys.exit(max(exit_codes) if exit_codes else 0)


if __name__ == '__main__':
    main()
