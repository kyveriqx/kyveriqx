"""
Single-process orchestrator for the BOD MIS pipeline.

Replaces three separate `python.runScript()` invocations (analyze + xlsx +
pptx) with one Python process — saving ~1-2s of interpreter boot + heavy
module import per script that we used to pay 3x.

Two extra wins layered on top:
  - Heavy modules (openpyxl, pptx, lxml) are imported once at the top, so
    when the per-stage scripts import them again via runpy they hit the
    sys.modules cache and return immediately.
  - The xlsx + pptx builders both read financial_summary.json (read-only)
    and have no other shared state, so they run in parallel threads. The
    underlying XML serialization in lxml releases the GIL, so threading
    gives real CPU concurrency — not just I/O overlap.

PDF conversion is intentionally kept as a separate `python.runScript()`
call (different CLI signature, and it's allowed to fail without aborting
the report).
"""
import os
import runpy
import sys
import threading
import time

# Pre-warm heavy imports so the per-stage scripts get cache hits.
import openpyxl  # noqa: F401
import pptx  # noqa: F401
from lxml import etree  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))


def _run(script_name: str) -> None:
    path = os.path.join(HERE, script_name)
    t0 = time.perf_counter()
    runpy.run_path(path, run_name="__main__")
    print(f"[pipeline] {script_name} ok in {time.perf_counter() - t0:.2f}s", flush=True)


# 1. Analyze must finish first — both builders consume its output JSON.
_run("analyze_financials.py")

# 2. Build the MIS workbook + BOD deck concurrently.
errors: list[tuple[str, BaseException]] = []


def _safe(name: str) -> None:
    try:
        _run(name)
    except BaseException as exc:
        errors.append((name, exc))


threads = [
    threading.Thread(target=_safe, args=("build_mis_excel.py",), name="mis_excel"),
    threading.Thread(target=_safe, args=("build_bod_deck.py",), name="bod_deck"),
]
for t in threads:
    t.start()
for t in threads:
    t.join()

if errors:
    for name, exc in errors:
        print(f"[pipeline] {name} FAILED: {exc}", file=sys.stderr, flush=True)
    sys.exit(1)

print("[pipeline] all stages complete", flush=True)
