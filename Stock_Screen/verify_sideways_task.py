"""只读历史任务报告，以原截止日复核横盘名单；数据失败单列为未验证。"""
import argparse
from collections import Counter
import json
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
from openpyxl import load_workbook

import screen_bowl_shape as screen
from sideways_data import fetch_sideways_history
from sideways_model import evaluate_sideways


def read_candidates(path):
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        rows = workbook["模型指标"].iter_rows(values_only=True)
        headers = next(rows)
        records = [dict(zip(headers, row)) for row in rows]
        return [row for row in records if row.get("碗型阶段") == "横盘未突破"]
    finally:
        workbook.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/cache"))
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--single-attempt", action="store_true", help="复核批次每个请求只尝试一次，不改变线上重试策略")
    args = parser.parse_args()
    screen.configure_network()
    if args.single_attempt:
        logging.info("复核通过 AKShare 适配层直接请求；不额外重试供应商接口")
    config = screen.load_screen_config(str(Path(__file__).parent / "configs/default_bottom.json"))
    candidates = read_candidates(args.report)

    def review(row):
        code = str(row["股票代码"]).zfill(6)
        as_of = str(row.get("筛选日期") or row["最新交易日"])[:10]
        listed = pd.to_datetime(row.get("上市时间"), errors="coerce")
        base = {"股票代码": code, "股票名称": row["股票名称"], "截止日": as_of}
        try:
            start = pd.Timestamp(as_of) - pd.DateOffset(years=config["sideways"]["history_years"])
            if pd.isna(listed) or listed > start:
                passed, metrics = evaluate_sideways(pd.DataFrame(), listed, as_of, config)
            else:
                bars = fetch_sideways_history(code, as_of, config, screen.fetch_stock_hist_em, args.cache_dir)
                passed, metrics = evaluate_sideways(bars, listed, as_of, config)
            status = "保留" if passed else "未验证" if metrics.get("未验证") else "淘汰"
        except Exception as exc:
            status = "未验证"
            metrics = {"未通过环节": "长期数据", "未通过原因": str(exc), "规则版本": config["sideways"]["version"]}
        return {**base, "结果": status, "指标": metrics}

    results = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 4))) as pool:
        for row in pool.map(review, candidates):
            results.append(row)
            if len(results) % 10 == 0 or len(results) == len(candidates):
                print(f"复核进度: {len(results)}/{len(candidates)}", flush=True)
    counts = Counter(row["结果"] for row in results)
    eliminated = Counter(row["指标"].get("未通过环节") for row in results if row["结果"] == "淘汰")
    payload = {"来源报告": str(args.report), "规则版本": config["sideways"]["version"],
               "原横盘数量": len(candidates), "结果统计": {key: counts[key] for key in ("保留", "淘汰", "未验证")},
               "首个失败环节": dict(eliminated), "股票": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str)+"\n")
    print(json.dumps({key: value for key,value in payload.items() if key != "股票"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
