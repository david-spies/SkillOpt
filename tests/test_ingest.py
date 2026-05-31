"""
SkillOpt — tests/test_ingest.py
Unit tests for scripts/ingest.py ingestion module.

Run: python -m pytest tests/test_ingest.py -v
"""

import json
import os
import sys
import textwrap
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from ingest import (
    ingest_direct,
    ingest_package,
    ingest_scan,
    is_skill_file,
    extract_skill_meta,
)


# ─────────────────────────────────────────────────────────
# FIXTURES
# ─────────────────────────────────────────────────────────

VALID_SKILL = textwrap.dedent("""\
    name: test-skill
    description: A test skill for unit testing ingestion
    version: 2.1.0
    author: test

    ## Instructions

    ### Step 1
    Do the thing correctly.

    ### Step 2
    Return a structured result.

    ## Input

    A query string.

    ## Output

    A structured response.

    ## Examples

    Input: "hello"
    Output: "world"
""")

INVALID_SKILL = textwrap.dedent("""\
    # Just a regular markdown file

    This is not a SKILL.md. It lacks the required section headings.
    It also lacks name and description fields.
""")

MINIMAL_SKILL = textwrap.dedent("""\
    name: minimal
    description: Minimal valid skill for testing purposes
    version: 0.1.0

    ## Instructions

    Do something.

    ## Input
    Text.

    ## Output
    Text.

    ## Examples
    n/a
""")


@pytest.fixture
def skill_file(tmp_path):
    p = tmp_path / "test-skill.md"
    p.write_text(VALID_SKILL)
    return p


@pytest.fixture
def invalid_file(tmp_path):
    p = tmp_path / "not-a-skill.md"
    p.write_text(INVALID_SKILL)
    return p


@pytest.fixture
def skill_zip(tmp_path):
    """Create a zip that mimics an Ai-Agent Builder package."""
    zp = tmp_path / "agent-package.zip"
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_STORED) as zf:
        zf.writestr("my-agent/SKILL.md", VALID_SKILL)
        zf.writestr("my-agent/AGENTS.md", "# AGENTS.md\n## Overview\nTest agent.")
        zf.writestr("my-agent/README.md", "# My Agent\n\nThis is the readme.")
        zf.writestr("my-agent/evals/golden-set/general.json",
                    json.dumps([{"id": 1, "query": "test", "expected_output": "test"}]))
    return zp


@pytest.fixture
def multi_skill_zip(tmp_path):
    """Zip with two SKILL.md files (multi-skill package)."""
    zp = tmp_path / "multi-agent-package.zip"
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_STORED) as zf:
        zf.writestr("pkg/skills/rag-retrieval.md", VALID_SKILL)
        zf.writestr("pkg/skills/code-review.md",
                    VALID_SKILL.replace("test-skill", "code-review").replace(
                        "A test skill", "Code review skill"))
        zf.writestr("pkg/README.md", "# Multi-skill package")
    return zp


@pytest.fixture
def skills_dir(tmp_path):
    """Directory containing multiple skill files at varying depths."""
    # Root level
    (tmp_path / "root-skill.md").write_text(VALID_SKILL)
    # Subdirectory
    sub = tmp_path / "agents" / "skills"
    sub.mkdir(parents=True)
    (sub / "rag-retrieval.md").write_text(VALID_SKILL)
    (sub / "code-review.md").write_text(MINIMAL_SKILL)
    # Non-skill markdown
    (sub / "README.md").write_text(INVALID_SKILL)
    # Hidden dir (should be skipped)
    hidden = tmp_path / ".hidden"
    hidden.mkdir()
    (hidden / "hidden-skill.md").write_text(VALID_SKILL)
    # .agents dir (should NOT be skipped — Builder uses it)
    agents = tmp_path / ".agents" / "skills"
    agents.mkdir(parents=True)
    (agents / "builder-skill.md").write_text(MINIMAL_SKILL)
    return tmp_path


# ─────────────────────────────────────────────────────────
# is_skill_file
# ─────────────────────────────────────────────────────────

class TestIsSkillFile:

    def test_valid_skill(self):
        assert is_skill_file(VALID_SKILL) is True

    def test_minimal_skill(self):
        assert is_skill_file(MINIMAL_SKILL) is True

    def test_invalid_no_instructions(self):
        assert is_skill_file(INVALID_SKILL) is False

    def test_empty_string(self):
        assert is_skill_file("") is False

    def test_instructions_with_name(self):
        assert is_skill_file("name: test-skill\n## Instructions\nDo something.") is True

    def test_name_without_instructions(self):
        assert is_skill_file("name: test\ndescription: test") is False


# ─────────────────────────────────────────────────────────
# extract_skill_meta
# ─────────────────────────────────────────────────────────

class TestExtractSkillMeta:

    def test_extracts_name(self):
        meta = extract_skill_meta(VALID_SKILL)
        assert meta['name'] == 'test-skill'

    def test_extracts_description(self):
        meta = extract_skill_meta(VALID_SKILL)
        assert 'test skill' in meta['description'].lower()

    def test_extracts_version(self):
        meta = extract_skill_meta(VALID_SKILL)
        assert meta['version'] == '2.1.0'

    def test_extracts_author(self):
        meta = extract_skill_meta(VALID_SKILL)
        assert meta['author'] == 'test'

    def test_line_count(self):
        meta = extract_skill_meta(VALID_SKILL)
        assert meta['line_count'] == len(VALID_SKILL.splitlines())

    def test_inst_lines_positive(self):
        meta = extract_skill_meta(VALID_SKILL)
        assert meta['inst_lines'] > 0

    def test_has_input_output(self):
        meta = extract_skill_meta(VALID_SKILL)
        assert meta['has_input'] is True
        assert meta['has_output'] is True

    def test_missing_fields_return_empty(self):
        meta = extract_skill_meta("## Instructions\nDo something.")
        assert meta['name'] == ''
        assert meta['version'] == ''

    def test_version_not_present(self):
        text = "name: test\ndescription: test\n## Instructions\nDo something."
        meta = extract_skill_meta(text)
        assert meta['version'] == ''


# ─────────────────────────────────────────────────────────
# ingest_direct
# ─────────────────────────────────────────────────────────

class TestIngestDirect:

    def test_loads_valid_skill(self, skill_file):
        results = ingest_direct(str(skill_file))
        assert len(results) == 1
        assert results[0]['source'] == 'direct'
        assert 'test-skill' in results[0]['meta']['name']

    def test_returns_empty_for_missing_file(self, tmp_path):
        results = ingest_direct(str(tmp_path / "nonexistent.md"))
        assert results == []

    def test_returns_empty_for_invalid_skill(self, invalid_file):
        results = ingest_direct(str(invalid_file))
        assert results == []

    def test_text_content_matches_file(self, skill_file):
        results = ingest_direct(str(skill_file))
        assert results[0]['text'] == skill_file.read_text()

    def test_path_is_resolved(self, skill_file):
        results = ingest_direct(str(skill_file))
        assert results[0]['path'].is_absolute()

    def test_meta_populated(self, skill_file):
        results = ingest_direct(str(skill_file))
        meta = results[0]['meta']
        assert meta['name'] == 'test-skill'
        assert meta['version'] == '2.1.0'
        assert meta['line_count'] > 0

    def test_accepts_minimal_skill(self, tmp_path):
        p = tmp_path / "minimal.md"
        p.write_text(MINIMAL_SKILL)
        results = ingest_direct(str(p))
        assert len(results) == 1


# ─────────────────────────────────────────────────────────
# ingest_package
# ─────────────────────────────────────────────────────────

class TestIngestPackage:

    def test_extracts_skill_from_zip(self, skill_zip):
        results = ingest_package(str(skill_zip))
        assert len(results) == 1

    def test_source_is_zip(self, skill_zip):
        results = ingest_package(str(skill_zip))
        assert results[0]['source'] == 'zip'

    def test_zip_path_recorded(self, skill_zip):
        results = ingest_package(str(skill_zip))
        assert str(skill_zip) in results[0]['zip_path']

    def test_zip_entry_recorded(self, skill_zip):
        results = ingest_package(str(skill_zip))
        assert 'SKILL.md' in results[0]['zip_entry']

    def test_extracts_multiple_skills(self, multi_skill_zip):
        results = ingest_package(str(multi_skill_zip))
        assert len(results) == 2

    def test_skill_names_distinct(self, multi_skill_zip):
        results = ingest_package(str(multi_skill_zip))
        names = [r['path'].name for r in results]
        assert len(set(names)) == 2

    def test_returns_empty_for_missing_zip(self, tmp_path):
        results = ingest_package(str(tmp_path / "nonexistent.zip"))
        assert results == []

    def test_returns_empty_for_zip_without_skills(self, tmp_path):
        zp = tmp_path / "no-skills.zip"
        with zipfile.ZipFile(zp, 'w') as zf:
            zf.writestr("README.md", "# Just a readme")
            zf.writestr("config.json", '{"key": "value"}')
        results = ingest_package(str(zp))
        assert results == []

    def test_skips_macos_metadata(self, tmp_path):
        zp = tmp_path / "mac-package.zip"
        with zipfile.ZipFile(zp, 'w') as zf:
            zf.writestr("__MACOSX/._SKILL.md", "mac garbage")
            zf.writestr("agent/SKILL.md", VALID_SKILL)
        results = ingest_package(str(zp))
        assert len(results) == 1

    def test_returns_empty_for_invalid_zip(self, tmp_path):
        bad = tmp_path / "bad.zip"
        bad.write_bytes(b"not a zip file at all")
        results = ingest_package(str(bad))
        assert results == []

    def test_skill_text_is_valid(self, skill_zip):
        results = ingest_package(str(skill_zip))
        assert '## Instructions' in results[0]['text']
        assert is_skill_file(results[0]['text'])

    def test_accepts_custom_extract_dir(self, skill_zip, tmp_path):
        extract_to = tmp_path / "extracted"
        extract_to.mkdir()
        results = ingest_package(str(skill_zip), extract_dir=str(extract_to))
        assert len(results) == 1
        # Files should be in the custom dir
        assert str(extract_to) in str(results[0]['path'])


# ─────────────────────────────────────────────────────────
# ingest_scan
# ─────────────────────────────────────────────────────────

class TestIngestScan:

    def test_finds_skills_recursively(self, skills_dir):
        results = ingest_scan(str(skills_dir))
        # Should find root-skill.md, rag-retrieval.md, code-review.md, builder-skill.md
        # Should NOT include README.md (no ## Instructions)
        assert len(results) >= 3

    def test_excludes_non_skill_md(self, skills_dir):
        results = ingest_scan(str(skills_dir))
        filenames = [r['path'].name for r in results]
        assert 'README.md' not in filenames

    def test_includes_dotAgents_dir(self, skills_dir):
        results = ingest_scan(str(skills_dir))
        filenames = [r['path'].name for r in results]
        assert 'builder-skill.md' in filenames

    def test_excludes_hidden_dirs(self, skills_dir):
        results = ingest_scan(str(skills_dir))
        filenames = [r['path'].name for r in results]
        assert 'hidden-skill.md' not in filenames

    def test_source_is_scan(self, skills_dir):
        results = ingest_scan(str(skills_dir))
        assert all(r['source'] == 'scan' for r in results)

    def test_returns_empty_for_missing_dir(self, tmp_path):
        results = ingest_scan(str(tmp_path / "nonexistent"))
        assert results == []

    def test_returns_empty_for_file_not_dir(self, skill_file):
        results = ingest_scan(str(skill_file))
        assert results == []

    def test_empty_directory_returns_empty(self, tmp_path):
        results = ingest_scan(str(tmp_path))
        assert results == []

    def test_rel_path_populated(self, skills_dir):
        results = ingest_scan(str(skills_dir))
        assert all('rel' in r for r in results)
        assert all(r['rel'] for r in results)

    def test_max_depth_respected(self, tmp_path):
        # Create skill at depth 3
        deep = tmp_path / "a" / "b" / "c"
        deep.mkdir(parents=True)
        (deep / "deep-skill.md").write_text(VALID_SKILL)

        shallow = ingest_scan(str(tmp_path), max_depth=2)
        deep_scan = ingest_scan(str(tmp_path), max_depth=3)

        shallow_names = [r['path'].name for r in shallow]
        deep_names    = [r['path'].name for r in deep_scan]

        assert 'deep-skill.md' not in shallow_names
        assert 'deep-skill.md' in deep_names

    def test_meta_populated_for_all_results(self, skills_dir):
        results = ingest_scan(str(skills_dir))
        for r in results:
            assert r['meta']['line_count'] > 0
            assert 'inst_lines' in r['meta']
