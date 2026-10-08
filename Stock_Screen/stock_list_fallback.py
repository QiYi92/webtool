"""使用近期股票名单和腾讯报价降级，避免把旧价格或市值当实时数据。"""
import logging
from datetime import datetime, timedelta
from pathlib import Path
import re
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

CACHE_MAX_AGE_DAYS = 7
COLUMNS = ("代码", "名称", "最新价", "总市值", "上市时间", "板块", "概念")


def recent_stock_caches(directory: Path, now=None):
    today = (now or datetime.now(ZoneInfo("Asia/Shanghai"))).date()
    candidates = []
    for path in directory.glob("stock_spot_*.csv"):
        try:
            day = datetime.strptime(path.stem.removeprefix("stock_spot_"), "%Y%m%d").date()
        except ValueError:
            continue
        if 0 <= (today - day).days <= CACHE_MAX_AGE_DAYS:
            candidates.append((day, path))
    return [path for _, path in sorted(candidates, reverse=True)]


def valid_stock_cache(data):
    return (data is not None and not data.empty and set(COLUMNS).issubset(data.columns)
            and data["代码"].astype(str).str.fullmatch(r"\d{6}").all())


def read_tencent_quotes(symbols):
    with requests.Session() as session:
        session.trust_env = False
        response = session.get("https://qt.gtimg.cn/q=" + ",".join(symbols), timeout=10)
        response.raise_for_status()
        response.encoding = "gbk"
        return response.text


def refresh_cached_universe(cached: pd.DataFrame, source: Path, now=None):
    now = now or datetime.now(ZoneInfo("Asia/Shanghai"))
    quotes = {}
    codes = cached["代码"].drop_duplicates().tolist()
    for offset in range(0, len(codes), 80):
        batch = codes[offset:offset+80]
        symbols = [("sh" if code.startswith("6") else "bj" if code.startswith(("4", "8", "9")) else "sz") + code for code in batch]
        for attempt in range(2):
            try:
                text = read_tencent_quotes(symbols)
                break
            except Exception as exc:
                if attempt == 1:
                    raise RuntimeError(f"腾讯股票池报价获取失败，未使用旧价格: {exc}") from exc
        for payload in re.findall(r'="([^"\r\n]*)"', text):
            fields = payload.split("~")
            if len(fields) <= 45 or fields[2] not in batch or not fields[1].strip():
                continue
            try:
                price, market_value = float(fields[3]), float(fields[45]) * 100_000_000
                quoted_at = datetime.strptime(fields[30], "%Y%m%d%H%M%S").replace(tzinfo=ZoneInfo("Asia/Shanghai"))
                if (not np.isfinite([price, market_value]).all() or price <= 0 or market_value <= 0
                        or not timedelta(0) <= now - quoted_at <= timedelta(days=CACHE_MAX_AGE_DAYS)):
                    continue
                quotes[fields[2]] = (fields[1], price, market_value)
            except (ValueError, IndexError):
                continue
        if offset % 800 == 0:
            logging.info("备用股票池报价更新: %s/%s", min(offset+80, len(codes)), len(codes))
    if len(quotes) < max(1, len(codes) * .95):
        raise RuntimeError(f"腾讯股票池报价覆盖不足（{len(quotes)}/{len(codes)}），未使用不完整股票池或旧价格")
    result = cached.loc[cached["代码"].isin(quotes)].copy()
    result["名称"] = result["代码"].map(lambda code: quotes[code][0])
    result["最新价"] = result["代码"].map(lambda code: quotes[code][1])
    result["总市值"] = result["代码"].map(lambda code: quotes[code][2])
    logging.warning("股票池降级：名单/上市时间/行业来自 %s；名称、价格、市值来自腾讯最新可用报价；有效 %s 只，缺失或过期报价 %s 只。", source.name, len(result), len(codes)-len(quotes))
    return result.reset_index(drop=True)
