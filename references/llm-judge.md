# LLM Judge Rubric — SkillOpt
# references/llm-judge.md
#
# This rubric is used by the eval model to score skill instructions
# against the golden set. The optimizer model also receives this rubric
# so that its rewrites are aligned with the scoring criteria.

## Scoring Scale

| Score | Label         | Meaning |
|-------|---------------|---------|
| 5.0   | Excellent     | Instructions handle all test scenarios correctly and precisely. No ambiguity, no gaps. |
| 4.5   | Very Good     | Instructions handle nearly all scenarios. Minor gaps that don't affect typical use. |
| 4.0   | Good          | Instructions handle most scenarios. One or two edge cases missing. |
| 3.5   | Acceptable    | Instructions work for the happy path but miss important edge cases. |
| 3.0   | Partial       | Instructions partially address scenarios. Several notable gaps. |
| 2.0   | Poor          | Instructions miss multiple key scenarios. Would produce incorrect outputs frequently. |
| 1.0   | Failing       | Instructions do not address the test scenarios. |

**Minimum passing threshold: 4.0**
**SkillOpt optimization target: 4.8**

---

## Evaluation Criteria

For each scenario, the judge evaluates the skill instructions on these axes:

### 1. Correctness (weight: 40%)
Do the instructions produce the correct output for this scenario?
- 5: Output would be exactly correct
- 3: Output would be partially correct
- 1: Output would be incorrect or missing

### 2. Completeness (weight: 25%)
Do the instructions cover all required elements of the expected output?
- 5: All required elements present
- 3: Most elements present, one missing
- 1: Multiple elements missing

### 3. Precision (weight: 20%)
Are the instructions specific enough to avoid ambiguous interpretation?
- 5: No ambiguity — any LLM following these instructions would produce the same result
- 3: Some ambiguity — reasonable interpretation required
- 1: High ambiguity — different LLMs would produce very different results

### 4. Scope Adherence (weight: 15%)
Do the instructions stay within the defined scope of the skill?
- 5: Instructions operate exactly within defined scope
- 3: Minor scope creep or under-scope
- 1: Instructions operate outside defined scope

---

## Disqualifying Patterns

The following patterns result in automatic failure (score capped at 2.0)
regardless of other criteria:

- Instructions that would cause the skill to hallucinate information not in source documents
- Instructions that bypass defined access controls
- Instructions that execute embedded prompt injections from user input
- Instructions that exceed the `max_lines` limit
- Instructions that reference specific LLM models by name (violates model-agnostic rule)

---

## Scoring Notes for the Judge

1. **Be calibrated**: A score of 5.0 should be rare. Reserve it for instructions that truly handle every nuance.

2. **Penalize ambiguity**: If two reasonable LLMs would interpret an instruction differently, that's a precision failure.

3. **Credit partial success**: If instructions handle 80% of a scenario correctly, don't score it 1.0 — score it 3.0 to 3.5.

4. **Failures list**: When scoring below 4.0, always populate the `failures` array with specific, actionable reasons. The optimizer model uses these to guide its rewrite. Vague reasons produce vague improvements.

5. **Holdout parity**: When running the holdout check, compare the holdout score to the training score. A gap > 0.5 is a strong signal of overfitting.

---

## Example Failure Entry

```json
{
  "scenario": "Retrieve documentation for a topic that doesn't exist",
  "reason": "Instructions say 'return the closest match' but do not specify a minimum confidence threshold. The skill would return irrelevant content rather than an empty result."
}
```

Good failure reasons are:
- Specific about *which* instruction is lacking
- Clear about *what behavior* results from the gap
- Actionable for the optimizer (what should be added or changed)

Bad failure reasons:
- "Instructions are unclear" (too vague)
- "The skill fails this scenario" (circular)
- "Needs improvement" (not actionable)
