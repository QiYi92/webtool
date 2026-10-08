"""AKShare-backed market data adapter used by all investment strategies."""
from __future__ import annotations

import importlib
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from threading import Event, Thread
from typing import Any

class AKShareDataError(RuntimeError):
    """AKShare or its upstream source failed to return usable market data."""


class AKShareConnectionError(AKShareDataError):
    """An AKShare request could not reach its upstream after retries."""


def _activate_managed_version() -> None:
    state_dir = Path(os.getenv(
        "AKSHARE_STATE_DIR",
        str(Path(__file__).resolve().parents[1] / "backend/data/investment_prediction/akshare"),
    ))
    pointer = state_dir / "active.json"
    if not pointer.is_file():
        return
    try:
        version = json.loads(pointer.read_text(encoding="utf-8"))["version"]
        env_path = state_dir / "versions" / str(version)
        for site_packages in env_path.glob("lib/python*/site-packages"):
            value = str(site_packages)
            if value not in sys.path:
                sys.path.insert(0, value)
            return
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logging.warning("读取 AKShare 已激活版本失败: %s", exc)


_activate_managed_version()

# Load data libraries only after the selected AKShare environment is active.
import pandas as pd  # noqa: E402 -- use the selected version's site-packages
import requests  # noqa: E402


def akshare_module():
    _activate_managed_version()
    try:
        return importlib.import_module("akshare")
    except ImportError as exc:
        raise AKShareDataError("AKShare 未安装，请安装后端依赖并重启服务") from exc


def _invoke_with_deadline(function: Any, kwargs: dict[str, Any], seconds: float) -> Any:
    """Bound AKShare functions whose internal HTTP requests omit a timeout."""
    completed = Event()
    outcome: dict[str, Any] = {}

    def invoke() -> None:
        try:
            outcome["frame"] = function(**kwargs)
        except BaseException as exc:
            outcome["error"] = exc
        finally:
            completed.set()

    Thread(target=invoke, daemon=True).start()
    if not completed.wait(seconds):
        raise AKShareConnectionError(f"AKShare 请求超过 {seconds:g} 秒仍无响应")
    if "error" in outcome:
        raise outcome["error"]
    return outcome["frame"]


def _call(interface: str, **kwargs: Any) -> pd.DataFrame:
    function = getattr(akshare_module(), interface, None)
    if not callable(function):
        raise AKShareDataError(f"AKShare 缺少接口 {interface}")
    for attempt in range(3):
        try:
            timeout = 90 if interface == "stock_zh_a_spot_tx" else 60 if interface in ("stock_info_bj_name_code", "stock_zh_a_daily") else 45
            frame = _invoke_with_deadline(function, kwargs, timeout)
            if not isinstance(frame, pd.DataFrame):
                raise AKShareDataError(f"AKShare {interface} 返回类型无效")
            if frame.empty:
                raise AKShareDataError(f"AKShare {interface} 返回空数据")
            return frame
        except requests.RequestException as exc:
            if attempt == 2:
                raise AKShareConnectionError(f"AKShare {interface} 连续 3 次连接失败: {exc}") from exc
            logging.warning("AKShare %s 连接失败，重试 %s/2: %s", interface, attempt + 1, exc)
            time.sleep(0.5 * (attempt + 1))
        except AKShareDataError:
            raise
        except Exception as exc:
            raise AKShareDataError(f"AKShare {interface} 调用失败: {exc}") from exc
    raise AssertionError("AKShare 重试循环未返回结果")


def fetch_stock_spot() -> pd.DataFrame:
    """Fetch live Tencent quotes and current exchange listing metadata via AKShare."""
    raw = _call("stock_zh_a_spot_tx")
    if raw.empty:
        raise AKShareDataError("AKShare 腾讯 A 股实时行情返回空数据")
    required = {"code", "name", "zxj", "zsz"}
    missing = required.difference(raw.columns)
    if missing:
        raise AKShareDataError(f"AKShare 腾讯 A 股实时行情缺少字段: {sorted(missing)}")
    codes = raw["code"].astype(str).str.extract(r"(\d{6})$")[0]
    if codes.isna().any() or codes.duplicated().any():
        raise AKShareDataError("AKShare 腾讯 A 股实时行情代码缺失或重复")
    result = pd.DataFrame({
        "代码": codes,
        "名称": raw["name"].astype(str),
        "最新价": pd.to_numeric(raw["zxj"], errors="coerce"),
        # Tencent zsz is in 100-million-yuan units; the screener uses yuan.
        "总市值": pd.to_numeric(raw["zsz"], errors="coerce") * 100_000_000,
    })
    if result[["最新价", "总市值"]].isna().any().any():
        raise AKShareDataError("AKShare 腾讯 A 股实时行情价格或总市值缺失")
    if (result[["最新价", "总市值"]] <= 0).any().any():
        raise AKShareDataError("AKShare 腾讯 A 股实时行情价格或总市值无效")

    listings = []
    for interface, kwargs, code_col, date_col, sector_col in (
        ("stock_info_sh_name_code", {"symbol": "主板A股"}, "证券代码", "上市日期", None),
        ("stock_info_sz_name_code", {"symbol": "A股列表"}, "A股代码", "A股上市日期", "所属行业"),
        ("stock_info_bj_name_code", {}, "证券代码", "上市日期", "所属行业"),
    ):
        listing = _call(interface, **kwargs)
        required_columns = {code_col, date_col} | ({sector_col} if sector_col else set())
        missing = required_columns.difference(listing.columns)
        if missing:
            raise AKShareDataError(f"AKShare {interface} 缺少字段: {sorted(missing)}")
        listing = pd.DataFrame({
            "代码": listing[code_col].astype(str).str.extract(r"(\d{6})$")[0],
            "上市时间": listing[date_col],
            "板块": listing[sector_col] if sector_col else None,
        })
        listings.append(listing.dropna(subset=["代码"]))
    listing_data = pd.concat(listings, ignore_index=True)
    if listing_data["代码"].duplicated().any():
        raise AKShareDataError("AKShare 交易所上市资料存在重复股票代码")
    result = result.merge(listing_data, on="代码", how="left", validate="one_to_one")
    result["概念"] = ""
    if result.empty:
        raise AKShareDataError("AKShare A 股实时行情没有有效报价")
    return result.reset_index(drop=True)


@lru_cache(maxsize=4096)
def fetch_stock_info(symbol: str) -> pd.DataFrame:
    code = str(symbol).strip().zfill(6)
    state_dir = Path(os.getenv(
        "AKSHARE_STATE_DIR",
        str(Path(__file__).resolve().parents[1] / "backend/data/investment_prediction/akshare"),
    ))
    cache_path = state_dir / "profile-cache" / f"{code}.json"
    try:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        cached_at = datetime.fromisoformat(cached["cached_at"])
        if datetime.now(timezone.utc) - cached_at.astimezone(timezone.utc) <= timedelta(days=30):
            frame = pd.DataFrame(cached["items"])
            if {"item", "value"}.issubset(frame.columns) and not frame.empty:
                return frame[["item", "value"]]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    raw = _call("stock_profile_cninfo", symbol=code)
    if not {"上市日期", "所属行业"}.issubset(raw.columns):
        raise AKShareDataError(f"AKShare 个股资料字段无效: {code}")
    result = pd.DataFrame({"item": ["上市时间", "行业"], "value": [raw.iloc[0]["上市日期"], raw.iloc[0]["所属行业"]]})
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        items = [
            {"item": str(row.item), "value": None if pd.isna(row.value) else str(row.value)}
            for row in result.itertuples(index=False)
        ]
        temporary = cache_path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps({"cached_at": datetime.now(timezone.utc).isoformat(), "items": items}, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, cache_path)
    except OSError as exc:
        logging.warning("AKShare 个股基础资料缓存写入失败 %s: %s", code, exc)
    return result


def fetch_stock_history(
    symbol: str,
    start_date: str,
    end_date: str,
    adjust: str = "qfq",
    period: str = "daily",
) -> pd.DataFrame:
    code = str(symbol).strip().zfill(6)
    if period != "daily":
        raise AKShareDataError("AKShare 腾讯行情仅支持日线")
    if adjust not in ("qfq", "hfq", ""):
        raise AKShareDataError(f"不支持的复权方式: {adjust}")
    market = "sh" if code.startswith("6") else "sz" if code.startswith(("0", "3")) else "bj"
    # Tencent's historical API currently has no usable Beijing Exchange bars.
    # AKShare's Sina history covers those codes with the same adjusted fields.
    interface = "stock_zh_a_daily" if market == "bj" else "stock_zh_a_hist_tx"
    kwargs = {
        "symbol": f"{market}{code}",
        "start_date": str(start_date).replace("-", ""),
        "end_date": str(end_date).replace("-", ""),
        "adjust": adjust,
    }
    if market != "bj":
        kwargs["timeout"] = 15
    raw = _call(interface, **kwargs)
    fields = {"date": "日期", "open": "开盘", "close": "收盘", "high": "最高", "low": "最低",
              "volume": "成交量", "amount": "成交额", "turnover": "换手率"}
    missing = set(fields).difference(raw.columns)
    if missing:
        raise AKShareDataError(f"AKShare 日线 {code} 缺少字段: {sorted(missing)}")
    result = raw.rename(columns=fields).copy()
    # AKShare's Tencent history returns shares and fractional turnover;
    # the existing screener expects lots and percentage points.
    result["成交量"] = pd.to_numeric(result["成交量"], errors="coerce") / 100
    result["换手率"] = pd.to_numeric(result["换手率"], errors="coerce") * 100
    result["股票代码"] = code
    required = {"日期", "开盘", "收盘", "最高", "最低", "成交量", "成交额", "换手率", "股票代码"}
    missing = required.difference(result.columns)
    if missing:
        raise AKShareDataError(f"AKShare 日线 {code} 缺少字段: {sorted(missing)}")
    for field in ("开盘", "收盘", "最高", "最低", "成交量", "成交额", "换手率"):
        result[field] = pd.to_numeric(result[field], errors="coerce")
    result["日期"] = pd.to_datetime(result["日期"], errors="coerce")
    result = result.dropna(subset=["日期", "开盘", "收盘", "最高", "最低", "成交量"])
    result = result.sort_values("日期").reset_index(drop=True)
    if result.empty:
        raise AKShareDataError(f"AKShare 日线 {code} 无有效交易记录")
    return result


def version() -> str:
    return str(getattr(akshare_module(), "__version__", "unknown"))
