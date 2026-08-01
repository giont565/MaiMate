"""GET /health — 行為健檢報告。讀預計算 JSON，零重運算。"""
import json
from pathlib import Path

REPORT = Path(__file__).parent.parent.parent / "data" / "health_report.json"


def handler(event, context):
    section = (event.get("queryStringParameters") or {}).get("section", "all")
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    payload = report if section == "all" else {section: report.get(section)}
    return {"statusCode": 200,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=3600"},
            "body": json.dumps(payload, ensure_ascii=False)}
