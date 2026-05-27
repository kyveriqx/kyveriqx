"""
Shared config loader for the BOD MIS generation pipeline.

Reads BOD_MIS_CONFIG env var (a JSON file written by the Trigger.dev task) and
exposes: BRANDING, OUTLOOK, FILES, WORKDIR.

Falls back to local dev defaults when env vars are absent — so existing
standalone runs of analyze_financials.py / build_mis_excel.py / build_bod_deck.py
continue to work against the sample XLSX files in the project root.
"""
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_BRANDING = {
    # Never shown in real runs (Step 1 of the wizard sets these) — keep
    # neutral fallbacks instead of the bracketed placeholders that look
    # like a half-finished template if they ever leak through.
    "companyName": "Your Company",
    "tagline": "Board Report",
    "vision": "",
    "logoDataUrl": None,
    "primaryColor": "#1F3864",
    "accentColor": "#BF8F00",
    "reportingPeriod": "FY 2024-25",
    "preparedFor": "Board of Directors",
}

DEFAULT_OUTLOOK = {
    "growth": {
        "tag": "GROWTH",
        "title": "Revenue & Market Expansion",
        "bullets": [
            "[Insert revenue target for FY 25-26]",
            "[Insert new market / geography plans]",
            "[Insert new product launches]",
            "[Insert channel expansion — e-commerce / B2B]",
        ],
    },
    "profitability": {
        "tag": "PROFITABILITY",
        "title": "Margin & Cost Discipline",
        "bullets": [
            "[Insert EBITDA margin target]",
            "[Insert opex optimization initiatives]",
            "[Insert raw material / sourcing strategy]",
            "[Insert pricing actions]",
        ],
    },
    "capability": {
        "tag": "CAPABILITY",
        "title": "People, Tech & Infra",
        "bullets": [
            "[Insert hiring / talent plan]",
            "[Insert capex / tech investment]",
            "[Insert digital / automation roadmap]",
            "[Insert compliance / governance upgrades]",
        ],
    },
    "risks": [
        "Margin pressure — EBITDA buffer is limited for cost shocks.",
        "Customer concentration — top customers carry significant share of revenue.",
        "FX exposure on multi-currency receivables.",
        "Working capital build-up if collection cycles extend.",
        "Depreciation drag pulling EBIT into deficit.",
        "Geopolitical / freight cost risk on export-heavy revenue mix.",
    ],
    "asks": [
        "Approval for FY 2025-26 budget & capex plan.",
        "Guidance on customer concentration mitigation.",
        "Sign-off on financing strategy for working capital.",
        "Direction on geographic / product expansion bets.",
        "Input on margin recovery roadmap.",
        "Discussion on dividend / reinvestment policy.",
    ],
}

# Defaults used when running standalone in the project directory.
# Each value is a list of file paths (one or more files merged per section).
DEFAULT_FILES = {
    "gl":            [os.path.join(BASE, "GL Entry.xlsx")],
    "sales":         [os.path.join(BASE, "Sales Invoice Data.xlsx")],
    "purchase":      [os.path.join(BASE, "Purchase Invoice Data.xlsx")],
    "inventory":     [os.path.join(BASE, "Item Ledger Entry.xlsx")],
    "customer":      [os.path.join(BASE, "Customer ledger entry.xlsx")],
    "vendor":        [os.path.join(BASE, "Vendor Ledger Entry.xlsx")],
    "budget":        [],
    "customerAging": [],
    "vendorAging":   [],
}


def _normalize_files(raw):
    """Accept either {"gl": "path"} or {"gl": ["path1", "path2"]} and produce a {section: [paths]} dict."""
    out = {}
    for k, v in (raw or {}).items():
        if v is None:
            continue
        if isinstance(v, str):
            out[k] = [v] if v else []
        elif isinstance(v, list):
            out[k] = [p for p in v if isinstance(p, str) and p]
        else:
            out[k] = []
    return out


def _load():
    cfg_path = os.environ.get("BOD_MIS_CONFIG")
    if cfg_path and os.path.exists(cfg_path):
        with open(cfg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        branding = {**DEFAULT_BRANDING, **(data.get("branding") or {})}
        outlook = {**DEFAULT_OUTLOOK, **(data.get("outlook") or {})}
        files = {**DEFAULT_FILES, **_normalize_files(data.get("files"))}
        return branding, outlook, files
    return DEFAULT_BRANDING.copy(), DEFAULT_OUTLOOK.copy(), DEFAULT_FILES.copy()


BRANDING, OUTLOOK, FILES = _load()


def first_file(section):
    """Convenience: return the first available file path in a section, or None."""
    lst = FILES.get(section) or []
    for p in lst:
        if p and os.path.exists(p):
            return p
    return None


def all_files(section):
    """Return list of existing file paths for a section."""
    return [p for p in (FILES.get(section) or []) if p and os.path.exists(p)]

# Output / working directory for intermediates and final files
WORKDIR = os.environ.get("BOD_MIS_WORKDIR") or os.path.join(BASE, ".tmp")
os.makedirs(WORKDIR, exist_ok=True)

# Convenience: hex color → openpyxl-friendly 'RRGGBB' (no '#')
def hex_no_hash(c, fallback="1F3864"):
    if not c:
        return fallback
    return str(c).lstrip("#").upper()
