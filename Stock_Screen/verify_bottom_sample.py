"""按固定截止日复核单只股票的底部形态，不使用当前股票池筛历史市值。"""
import argparse
import json
from pathlib import Path

from bottom_model import evaluate_bottom
from screen_bowl_shape import fetch_bottom_k, load_screen_config, check_sideways_candidate, get_listing_date
import pandas as pd


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="002531")
    parser.add_argument("--as-of", default="2026-09-07")
    parser.add_argument("--listed-on", help="上市日期 YYYY-MM-DD；省略时向行情源查询")
    args = parser.parse_args()
    config = load_screen_config(str(Path(__file__).parent / "configs/default_bottom.json"))
    bars = fetch_bottom_k(args.symbol, config["basic"]["trend_lookback_count"], args.as_of)
    passed, metrics = evaluate_bottom(bars, config)
    if passed and metrics["碗型阶段"] == "横盘未突破":
        try:
            listed = pd.Timestamp(args.listed_on) if args.listed_on else get_listing_date(args.symbol)
            passed, extra = check_sideways_candidate(args.symbol, bars, listed, config)
            metrics.update(extra)
        except Exception as exc:
            passed = False
            metrics.update({"未验证": True, "未通过环节": "长期数据", "未通过原因": str(exc)})
    elif passed:
        metrics["规则版本"] = "bottom_v1_strength"
    print(json.dumps({"symbol": args.symbol, "as_of": args.as_of, "passed": passed, "metrics": metrics}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
