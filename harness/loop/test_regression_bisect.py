"""Unit tests for the regression bisect (injected rev-list + QA, hermetic).

Run from the repository root:
    python3 -m unittest harness.loop.test_regression_bisect
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.regression_bisect import find_first_bad  # noqa: E402

COMMITS = [f"c{i:02d}" for i in range(1, 9)]  # c01..c08, oldest first


def make_qa(first_bad_index):
    """QA that passes before `first_bad_index` and fails from it onward."""

    def qa(commit):
        index = COMMITS.index(commit)
        if index >= first_bad_index:
            return False, f"failing rules: player_exists (commit {commit})"
        return True, "all rules pass"

    return qa


def rev_list_for(good, bad):
    """Emulate `git rev-list --reverse --first-parent good..bad`."""
    bad_index = COMMITS.index(bad)
    return COMMITS[1 : bad_index + 1]  # exclude the good commit itself


class BisectTests(unittest.TestCase):
    def test_finds_first_bad_commit(self):
        calls = []

        def qa(commit):
            calls.append(commit)
            return make_qa(4)(commit)  # c05 is the first bad

        result = find_first_bad("c01", "c08", rev_list=rev_list_for, qa_at_commit=qa)
        self.assertEqual(result.verdict, "found")
        self.assertEqual(result.first_bad, "c05")
        # Binary search over 7 candidates must take far fewer than 7 QA runs.
        self.assertLessEqual(len(calls), 5)

    def test_all_green_range_reports_no_regression(self):
        def qa(commit):
            return True, "all rules pass"

        result = find_first_bad("c01", "c08", rev_list=rev_list_for, qa_at_commit=qa)
        self.assertEqual(result.verdict, "no_regression")
        self.assertEqual(len(result.steps), 1, "only the tip needs to be checked")

    def test_regression_at_first_commit(self):
        def qa(commit):
            return make_qa(1)(commit)  # c02 is already bad

        result = find_first_bad("c01", "c08", rev_list=rev_list_for, qa_at_commit=qa)
        self.assertEqual(result.verdict, "found")
        self.assertEqual(result.first_bad, "c02")

    def test_empty_range_is_an_error(self):
        result = find_first_bad(
            "c01", "c01", rev_list=lambda g, b: [], qa_at_commit=lambda c: (True, "")
        )
        self.assertEqual(result.verdict, "error")
        self.assertIn("no commits", result.message)

    def test_step_budget_yields_indeterminate(self):
        def qa(commit):
            return make_qa(6)(commit)

        result = find_first_bad(
            "c01", "c08", rev_list=rev_list_for, qa_at_commit=qa, max_steps=1
        )
        self.assertEqual(result.verdict, "indeterminate")
        self.assertEqual(len(result.steps), 1)

    def test_steps_capture_evidence(self):
        def qa(commit):
            return make_qa(4)(commit)

        result = find_first_bad("c01", "c08", rev_list=rev_list_for, qa_at_commit=qa)
        self.assertTrue(all(step.detail for step in result.steps))
        self.assertTrue(any(not step.passed for step in result.steps))
        self.assertTrue(any(step.passed for step in result.steps))


if __name__ == "__main__":
    unittest.main()
