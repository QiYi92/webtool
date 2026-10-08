"""AKShare 五年日线校验：统一复权、覆盖检查和按截止日缓存。"""
import json
import logging
from pathlib import Path
from typing import Callable
from uuid import uuid4

import numpy as np
import pandas as pd

from bottom_model import completed_daily_bars


class HistoryDataError(ValueError):
    """数据不可验证；与筛选规则淘汰区分。"""


def normalize_history(raw: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    columns = ["日期", "开盘", "收盘", "最高", "最低", "成交量", "换手率", "成交额"]
    if raw.empty or not set(columns).issubset(raw.columns):
        raise HistoryDataError("长期行情字段缺失或接口返回空数据")
    data = raw[columns].copy()
    data["日期"] = pd.to_datetime(data["日期"], errors="coerce")
    if data["日期"].isna().any():
        raise HistoryDataError("长期行情日期无效")
    for col in columns[1:]:
        data[col] = pd.to_numeric(data[col], errors="coerce")
    data = data.loc[data["日期"].between(start, end)]
    # 同一天出现相互冲突的价格/量能，不能简单保留其中一条。
    unique = data.drop_duplicates()
    if unique["日期"].duplicated().any():
        raise HistoryDataError("重复交易日数据冲突")
    return completed_daily_bars(unique.sort_values("日期").reset_index(drop=True))


def fetch_sideways_history(symbol: str, as_of: str, config: dict,
                           fetch: Callable, cache_dir: Path) -> pd.DataFrame:
    p = config["sideways"]
    end = pd.Timestamp(as_of).normalize()
    start = end - pd.DateOffset(years=p["history_years"])
    path = cache_dir / "sideways" / f"{symbol}_{start:%Y%m%d}_{end:%Y%m%d}_akshare_market_qfq_v2.json"

    def request(begin: pd.Timestamp, finish: pd.Timestamp):
        return normalize_history(fetch(symbol=symbol, start_date=begin.strftime("%Y%m%d"),
                                       end_date=finish.strftime("%Y%m%d"), adjust="qfq", period="daily"), begin, finish)

    def covered(data):
        return (len(data) >= p["min_history_bars"] and
                data["日期"].iloc[0] <= start + pd.Timedelta(days=p["start_tolerance_days"]) and
                data["日期"].iloc[-1] == end)

    def validate_values(data):
        price = data[["开盘", "收盘", "最高", "最低"]].to_numpy()
        recent = data[["成交量", "换手率", "成交额"]].iloc[-120:].to_numpy()
        if (not np.isfinite(price).all() or (price <= 0).any() or not np.isfinite(recent).all()
                or (data["最高"] < data[["开盘", "收盘", "最低"]].max(axis=1)).any()
                or (data["最低"] > data[["开盘", "收盘"]].min(axis=1)).any()):
            raise HistoryDataError("长期价格或近期量能字段无效")

    if path.exists():
        try:
            payload = json.loads(path.read_text())
            data = normalize_history(pd.DataFrame(payload["bars"]), start, end)
            if payload["source"] != "akshare_market_qfq_v2" or not covered(data):
                raise HistoryDataError("缓存来源或覆盖无效")
            validate_values(data)
            data["换手率"] /= 100.0
            return data
        except Exception as exc:
            logging.warning("长期行情缓存无效 %s: %s", symbol, exc)

    data = request(start, end)
    if not covered(data):
        # 后向分段，并留30个自然日重叠；每段用重叠交易日检查复权一致性。
        # 如供应商改变复权基准，拒绝拼接而不推算价格修正因子。
        parts = []
        finish = end
        while finish > start:
            begin = max(start, finish - pd.DateOffset(years=1))
            part = request(begin, finish)
            if parts:
                overlap = part.merge(parts[-1], on="日期", suffixes=("_left", "_right"))
                if overlap.empty:
                    raise HistoryDataError("分段行情没有重叠交易日，无法验证复权基准")
                for col in ("开盘", "收盘", "最高", "最低"):
                    if not np.allclose(overlap[f"{col}_left"], overlap[f"{col}_right"], rtol=1e-6, atol=1e-6):
                        raise HistoryDataError("分段行情复权基准不一致")
            parts.append(part)
            if begin == start:
                break
            finish = begin + pd.Timedelta(days=30)
        data = normalize_history(pd.concat(parts, ignore_index=True), start, end)
    if not covered(data):
        raise HistoryDataError("五年行情覆盖不足或末日缺失")

    # 缓存保留供应商原始百分数单位，读取/返回时只换算一次。
    # 无效数据不写入缓存，避免短暂字段缺失长期污染后续筛选。
    validate_values(data)
    serializable = data.copy()
    serializable["日期"] = serializable["日期"].dt.strftime("%Y-%m-%d")
    temp = path.with_suffix(f".{uuid4().hex}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp.write_text(json.dumps({"source": "akshare_market_qfq_v2", "bars": json.loads(serializable.to_json(orient="records"))}, ensure_ascii=False))
        temp.replace(path)
    except OSError as exc:
        logging.warning("长期行情缓存写入失败 %s: %s", symbol, exc)
    finally:
        if temp.exists():
            temp.unlink(missing_ok=True)
    data["换手率"] /= 100.0
    return data
