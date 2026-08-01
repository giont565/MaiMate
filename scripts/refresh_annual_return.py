#!/usr/bin/env python3
"""以 MAX read-only API 更新 health_report.json 的 live 年度報酬輸入資料。"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from analysis.annual_return import collect_live_annual_return  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--report", type=Path, default=ROOT / "data" / "health_report.json")
    parser.add_argument("--stdout", action="store_true", help="只輸出結果，不修改 report")
    args = parser.parse_args()

    live = collect_live_annual_return(args.year)
    if args.stdout:
        print(json.dumps(live, ensure_ascii=False, indent=2))
        return
    report = json.loads(args.report.read_text(encoding="utf-8"))
    report.setdefault("annual_return", {})[str(args.year)] = live
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已更新 {args.report} annual_return.{args.year}（只讀 MAX API，未送出交易／提領）")


if __name__ == "__main__":
    main()
