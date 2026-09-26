"""
analyze_results.py

Chapter 4 statistical analysis for the gamification capstone study.

Reads local users.json and results.json, then:
  1. Paired t-test: Pre-Test scores vs Post-Test scores (same students, before vs after)
  2. Pearson correlation: total gamification points earned vs academic improvement
     (Post-Test score minus Pre-Test score)

Run with:  python analyze_results.py
Requires:  pip install pandas scipy
"""

import json
import sys
from pathlib import Path

import pandas as pd
from scipy import stats

# ============================================================
# CONFIG
# ============================================================
DATA_DIR = Path("data")
USERS_FILE = DATA_DIR / "users.json"
RESULTS_FILE = DATA_DIR / "results.json"

ALPHA = 0.05  # significance threshold for the t-test


# ============================================================
# LOAD DATA
# ============================================================
def load_json(path: Path) -> list:
    if not path.exists():
        sys.exit(f"ERROR: {path} not found. Run this script from your project root.")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_dataframes():
    users = pd.DataFrame(load_json(USERS_FILE))
    results = pd.DataFrame(load_json(RESULTS_FILE))

    if users.empty or results.empty:
        sys.exit("ERROR: users.json or results.json is empty. Nothing to analyze.")

    required_result_cols = {"userId", "quiz_type", "score"}
    missing = required_result_cols - set(results.columns)
    if missing:
        sys.exit(f"ERROR: results.json is missing expected field(s): {missing}")

    return users, results


# ============================================================
# BUILD PER-STUDENT PRE/POST/POINTS TABLE
# ============================================================
def build_student_summary(users: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    """
    Collapses results.json into one row per student with:
      - pre_test_score   (their Pre-Test attempt's score)
      - post_test_score  (their Post-Test attempt's score)
    then joins in total gamification points from users.json.

    If a student has multiple Pre-Test or Post-Test attempts, the FIRST
    attempt is used for each (adjust `.first()` to `.mean()` below if your
    study design allows retakes and you want the average instead).
    """
    pre = (
        results[results["quiz_type"] == "pre-test"]
        .groupby("userId")["score"]
        .first()
        .rename("pre_test_score")
    )
    post = (
        results[results["quiz_type"] == "post-test"]
        .groupby("userId")["score"]
        .first()
        .rename("post_test_score")
    )

    summary = pd.concat([pre, post], axis=1).reset_index().rename(columns={"index": "userId"})

    # Bring in name, section, and total gamification points from users.json
    user_cols = ["id", "name"]
    if "section" in users.columns:
        user_cols.append("section")
    user_cols.append("points")

    summary = summary.merge(
        users[user_cols],
        left_on="userId",
        right_on="id",
        how="left"
    ).drop(columns=["id"])

    # Only keep students who have BOTH a pre-test and post-test score —
    # a paired t-test requires complete pairs.
    complete_pairs = summary.dropna(subset=["pre_test_score", "post_test_score"]).copy()

    dropped = len(summary) - len(complete_pairs)
    if dropped > 0:
        print(f"Note: {dropped} student(s) excluded — missing a Pre-Test or Post-Test score.\n")

    complete_pairs["improvement"] = complete_pairs["post_test_score"] - complete_pairs["pre_test_score"]

    return complete_pairs


# ============================================================
# OPTIONAL: FILTER TO GRADE 11 COHORT
# ============================================================
def filter_grade_11(summary: pd.DataFrame) -> pd.DataFrame:
    """
    Filters to the Grade 11 cohort if a 'section' or 'gradeLevel' field
    identifies grade level in users.json (e.g. section values like
    '11-STEM A'). Adjust the matching logic below to however your actual
    users.json encodes grade level.
    """
    if "section" in summary.columns:
        grade_11 = summary[summary["section"].astype(str).str.contains("11", na=False)]
        if not grade_11.empty:
            return grade_11
        print("Note: no rows matched a Grade 11 section pattern — using all students instead.\n")
    else:
        print("Note: no 'section'/grade field found in users.json — using all students instead.\n")

    return summary


# ============================================================
# STATISTICAL TESTS
# ============================================================
def run_paired_ttest(pre_scores: pd.Series, post_scores: pd.Series):
    t_stat, p_value = stats.ttest_rel(post_scores, pre_scores)
    return t_stat, p_value


def run_pearson_correlation(points: pd.Series, improvement: pd.Series):
    r_value, p_value = stats.pearsonr(points, improvement)
    return r_value, p_value


# ============================================================
# REPORTING
# ============================================================
def interpret_correlation_strength(r: float) -> str:
    abs_r = abs(r)
    if abs_r < 0.1:
        return "negligible"
    elif abs_r < 0.3:
        return "weak"
    elif abs_r < 0.5:
        return "moderate"
    elif abs_r < 0.7:
        return "strong"
    else:
        return "very strong"


def print_report(cohort_label: str, summary: pd.DataFrame,
                  t_stat: float, t_p: float,
                  r_val: float, r_p: float):

    n = len(summary)
    pre_mean = summary["pre_test_score"].mean()
    post_mean = summary["post_test_score"].mean()
    mean_gain = summary["improvement"].mean()

    print("=" * 60)
    print(f" CHAPTER 4 — STATISTICAL ANALYSIS  ({cohort_label}, n = {n})")
    print("=" * 60)

    print("\n--- Descriptive Statistics ---")
    print(f"Pre-Test mean score  : {pre_mean:.2f}")
    print(f"Post-Test mean score : {post_mean:.2f}")
    print(f"Mean improvement     : {mean_gain:+.2f}")

    print("\n--- 1. Paired T-Test (Pre-Test vs Post-Test) ---")
    print(f"t-statistic : {t_stat:.4f}")
    print(f"p-value     : {t_p:.4f}")

    if t_p < ALPHA:
        print(f"Result: statistically significant (p < {ALPHA}).")
        direction = "an improvement" if mean_gain > 0 else "a decline"
        print(f"Interpretation: Post-Test scores show {direction} over Pre-Test scores")
        print("that is unlikely to be due to chance. This supports rejecting the null")
        print("hypothesis that gamification has no effect on academic performance.")
    else:
        print(f"Result: NOT statistically significant (p >= {ALPHA}).")
        print("Interpretation: There is not enough evidence to conclude the observed")
        print("difference between Pre-Test and Post-Test scores reflects a real effect")
        print("rather than random variation. Fail to reject the null hypothesis.")

    print("\n--- 2. Pearson Correlation (Gamification Points vs Improvement) ---")
    print(f"r-value     : {r_val:.4f}  ({interpret_correlation_strength(r_val)} "
          f"{'positive' if r_val > 0 else 'negative'} correlation)")
    print(f"p-value     : {r_p:.4f}")

    if r_p < ALPHA:
        rel = "positively" if r_val > 0 else "negatively"
        print(f"Result: statistically significant (p < {ALPHA}).")
        print(f"Interpretation: Total gamification points earned is {rel} correlated")
        print("with academic improvement, and this relationship is unlikely to be due")
        print("to chance. This suggests engagement with the gamified system is")
        print("associated with the size of a student's score gain.")
    else:
        print(f"Result: NOT statistically significant (p >= {ALPHA}).")
        print("Interpretation: No reliable linear relationship was found between")
        print("gamification points and academic improvement in this sample — note that")
        print("correlation does not imply causation even when significant.")

    print("\n--- Per-Student Data ---")
    display_cols = ["name", "pre_test_score", "post_test_score", "improvement", "points"]
    display_cols = [c for c in display_cols if c in summary.columns]
    print(summary[display_cols].to_string(index=False))

    print("\n" + "=" * 60)
    print(" Reminder: p < 0.05 = statistically significant at the 95%")
    print(" confidence level. r ranges from -1 (perfect negative) to")
    print(" +1 (perfect positive); 0 means no linear relationship.")
    print("=" * 60)


# ============================================================
# MAIN
# ============================================