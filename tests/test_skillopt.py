"""
SkillOpt — tests/test_skillopt.py
Unit tests for core SkillOpt logic.

Run: python -m pytest tests/ -v
"""

import json
import os
import sys
import tempfile
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add scripts to path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from skillopt import SkillFile, GoldenSet, MemoriesLog, BaselineSaver, estimate_cost


# ─────────────────────────────────────────────────────────
# FIXTURES
# ─────────────────────────────────────────────────────────

SAMPLE_SKILL = textwrap.dedent("""\
    name: test-skill
    description: A test skill for unit testing
    version: 1.0.0
    author: test

    ## Instructions

    ### Step 1
    Do the thing.

    ### Step 2
    Return the result.

    ## Input

    A string.

    ## Output

    A string.

    ## Examples

    Input: "hello"
    Output: "world"
""")

SAMPLE_GOLDEN = [
    {"id": 1, "query": "test query 1", "expected_output": "expected 1", "partition": "train"},
    {"id": 2, "query": "test query 2", "expected_output": "expected 2", "partition": "train"},
    {"id": 3, "query": "test query 3", "expected_output": "expected 3", "partition": "holdout"},
]


@pytest.fixture
def skill_file(tmp_path):
    p = tmp_path / "test-skill.md"
    p.write_text(SAMPLE_SKILL, encoding="utf-8")
    return SkillFile(str(p))


@pytest.fixture
def golden_file(tmp_path):
    p = tmp_path / "golden.json"
    p.write_text(json.dumps(SAMPLE_GOLDEN), encoding="utf-8")
    return str(p)


# ─────────────────────────────────────────────────────────
# SkillFile tests
# ─────────────────────────────────────────────────────────

class TestSkillFile:

    def test_loads_file(self, skill_file):
        assert skill_file.raw is not None
        assert len(skill_file.raw) > 0

    def test_raises_on_missing_file(self):
        with pytest.raises(FileNotFoundError):
            SkillFile("/nonexistent/skill.md")

    def test_parses_instructions(self, skill_file):
        inst = skill_file.instructions
        assert "Step 1" in inst
        assert "Do the thing." in inst

    def test_parses_description(self, skill_file):
        desc = skill_file.description
        assert desc == "A test skill for unit testing"

    def test_line_count(self, skill_file):
        assert skill_file.line_count > 0

    def test_replace_instructions(self, skill_file):
        new_inst = "### New Step\nDo the new thing.\n"
        result = skill_file.replace_instructions(new_inst)
        assert "New Step" in result
        assert "Do the new thing." in result
        assert "## Input" in result  # other sections preserved

    def test_replace_instructions_preserves_other_sections(self, skill_file):
        new_inst = "### Replacement\nReplaced content.\n"
        result = skill_file.replace_instructions(new_inst)
        assert "## Output" in result
        assert "## Examples" in result

    def test_write_updates_raw(self, skill_file):
        new_content = SAMPLE_SKILL.replace("Do the thing.", "Do the updated thing.")
        skill_file.write(new_content)
        assert "Do the updated thing." in skill_file.raw
        assert "Do the thing." not in skill_file.raw

    def test_backup_creates_file(self, skill_file):
        backup = skill_file.backup()
        assert backup.exists()
        assert ".bak.md" in backup.name

    def test_raises_if_no_instructions_section(self, tmp_path):
        p = tmp_path / "no-instructions.md"
        p.write_text("name: test\n## Input\nSome input.\n")
        sf = SkillFile(str(p))
        with pytest.raises(ValueError, match="No ## Instructions"):
            sf.replace_instructions("new instructions")


# ─────────────────────────────────────────────────────────
# GoldenSet tests
# ─────────────────────────────────────────────────────────

class TestGoldenSet:

    def test_loads_scenarios(self, golden_file):
        gs = GoldenSet(golden_file)
        assert len(gs.all_scenarios) == 3

    def test_respects_explicit_partitions(self, golden_file):
        gs = GoldenSet(golden_file)
        assert len(gs.train) == 2
        assert len(gs.holdout) == 1

    def test_auto_split_when_no_partitions(self, tmp_path):
        scenarios = [{"id": i, "query": f"q{i}", "expected_output": f"e{i}"} for i in range(10)]
        p = tmp_path / "unpartitioned.json"
        p.write_text(json.dumps(scenarios))
        gs = GoldenSet(str(p), holdout_pct=0.20)
        assert len(gs.holdout) >= 1
        assert len(gs.train) + len(gs.holdout) == 10

    def test_raises_on_missing_file(self):
        with pytest.raises(FileNotFoundError):
            GoldenSet("/nonexistent/golden.json")

    def test_raises_on_non_array(self, tmp_path):
        p = tmp_path / "bad.json"
        p.write_text('{"not": "array"}')
        with pytest.raises(ValueError, match="JSON array"):
            GoldenSet(str(p))

    def test_summary_string(self, golden_file):
        gs = GoldenSet(golden_file)
        summary = gs.summary()
        assert "train" in summary
        assert "holdout" in summary

    def test_min_holdout_is_one(self, tmp_path):
        # Even with 0% specified, should hold out at least 1
        scenarios = [{"id": i, "query": f"q{i}", "expected_output": f"e{i}"} for i in range(5)]
        p = tmp_path / "small.json"
        p.write_text(json.dumps(scenarios))
        gs = GoldenSet(str(p), holdout_pct=0.0)
        assert len(gs.holdout) >= 1


# ─────────────────────────────────────────────────────────
# MemoriesLog tests
# ─────────────────────────────────────────────────────────

class TestMemoriesLog:

    def test_creates_file_on_append(self, tmp_path):
        log_path = tmp_path / "MEMORIES.md"
        log = MemoriesLog(str(log_path))
        log.append({"skill": "test.md", "score": 4.2})
        assert log_path.exists()

    def test_appends_json_block(self, tmp_path):
        log_path = tmp_path / "MEMORIES.md"
        log = MemoriesLog(str(log_path))
        log.append({"skill": "test.md", "baseline_score": 3.5, "final_score": 4.2})
        content = log_path.read_text()
        assert "SkillOpt Run" in content
        assert '"skill": "test.md"' in content
        assert "4.2" in content

    def test_multiple_appends_accumulate(self, tmp_path):
        log_path = tmp_path / "MEMORIES.md"
        log = MemoriesLog(str(log_path))
        log.append({"run": 1})
        log.append({"run": 2})
        content = log_path.read_text()
        assert content.count("SkillOpt Run") == 2

    def test_appends_to_existing_file(self, tmp_path):
        log_path = tmp_path / "MEMORIES.md"
        log_path.write_text("# Existing content\n")
        log = MemoriesLog(str(log_path))
        log.append({"new": "entry"})
        content = log_path.read_text()
        assert "Existing content" in content
        assert "new" in content


# ─────────────────────────────────────────────────────────
# BaselineSaver tests
# ─────────────────────────────────────────────────────────

class TestBaselineSaver:

    def test_creates_directory(self, tmp_path):
        saver = BaselineSaver(str(tmp_path / "baselines"))
        saver.save("test-skill.md", 4.2, {})
        assert (tmp_path / "baselines").exists()

    def test_saves_json_file(self, tmp_path):
        saver = BaselineSaver(str(tmp_path / "baselines"))
        path = saver.save("test-skill.md", 4.2, {"iterations": 5})
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["score"] == 4.2
        assert data["skill"] == "test-skill.md"
        assert data["iterations"] == 5

    def test_filename_contains_skill_stem(self, tmp_path):
        saver = BaselineSaver(str(tmp_path / "baselines"))
        path = saver.save("rag-retrieval.md", 4.5, {})
        assert "rag-retrieval" in path.name


# ─────────────────────────────────────────────────────────
# Cost estimator tests
# ─────────────────────────────────────────────────────────

class TestEstimateCost:

    def test_opus_costs_more_than_sonnet(self):
        opus_cost   = estimate_cost(1000, "claude-opus-4-20250514")
        sonnet_cost = estimate_cost(1000, "claude-sonnet-4-20250514")
        assert opus_cost > sonnet_cost

    def test_sonnet_costs_more_than_haiku(self):
        sonnet_cost = estimate_cost(1000, "claude-sonnet-4-20250514")
        haiku_cost  = estimate_cost(1000, "claude-haiku-4-5-20251001")
        assert sonnet_cost > haiku_cost

    def test_zero_tokens_zero_cost(self):
        assert estimate_cost(0, "claude-sonnet-4-20250514") == 0.0

    def test_unknown_model_uses_fallback(self):
        cost = estimate_cost(1000, "unknown-model")
        assert cost > 0  # should use fallback rate

    def test_cost_scales_linearly(self):
        cost_1k  = estimate_cost(1000, "claude-sonnet-4-20250514")
        cost_2k  = estimate_cost(2000, "claude-sonnet-4-20250514")
        assert abs(cost_2k - 2 * cost_1k) < 1e-10


# ─────────────────────────────────────────────────────────
# Integration: SkillFile round-trip
# ─────────────────────────────────────────────────────────

class TestRoundTrip:

    def test_instructions_survive_replace_and_reload(self, tmp_path):
        p = tmp_path / "skill.md"
        p.write_text(SAMPLE_SKILL)
        sf = SkillFile(str(p))

        new_instructions = "### Updated\nImproved instructions here.\n"
        new_content = sf.replace_instructions(new_instructions)
        sf.write(new_content)

        reloaded = SkillFile(str(p))
        assert "Improved instructions here." in reloaded.instructions
        # Original instructions gone
        assert "Do the thing." not in reloaded.instructions
        # Other sections intact
        assert "## Input" in reloaded.raw
        assert "## Output" in reloaded.raw

    def test_backup_then_restore(self, tmp_path):
        p = tmp_path / "skill.md"
        p.write_text(SAMPLE_SKILL)
        sf = SkillFile(str(p))

        backup = sf.backup()
        original_content = p.read_text()

        # Overwrite with bad content
        sf.write("# broken content\n")

        # Restore from backup
        p.write_text(backup.read_text())
        restored = SkillFile(str(p))
        assert restored.raw == original_content
