from __future__ import annotations

import argparse
import copy
import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from akshare_data import (
    AKShareConnectionError,
    AKShareDataError,
    fetch_stock_history,
    fetch_stock_info,
    fetch_stock_spot,
    version as akshare_version,
)

import numpy as np
import pandas as pd
import requests

from excel_exporter import export_sector_summary_excel
from bottom_model import completed_daily_bars, evaluate_bottom
from sideways_model import STAGES as SIDEWAYS_STAGES, evaluate_sideways
from sideways_data import HistoryDataError, fetch_sideways_history


class MarketDataConnectionError(RuntimeError):
    """行情接口不可用；必须终止任务，不能把网络故障当成筛选结果。"""


def is_market_data_connection_error(exc: BaseException) -> bool:
    """识别被多层 RuntimeError 包装的 requests 网络/HTTP 错误。"""
    pending = [exc]
    visited: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in visited:
            continue
        visited.add(id(current))
        if isinstance(current, (requests.RequestException, MarketDataConnectionError, AKShareConnectionError)):
            return True
        if current.__cause__ is not None:
            pending.append(current.__cause__)
        if current.__context__ is not None:
            pending.append(current.__context__)
    return False

MIN_MARKET_VALUE = 10_000_000_000
MIN_LISTED_DAYS = 365 * 3
MIN_K_DAYS = 15
K_LOOKBACK_DAYS = 45
TREND_K_DAYS = 250
TREND_LOOKBACK_COUNT = 260
SLEEP_SECONDS = 0.05
OUTPUT_DIR = "data"
CACHE_DIR = Path(OUTPUT_DIR) / "cache"
DEFAULT_CONFIG_PATH = Path("configs") / "default_bowl.json"
UNKNOWN_SECTOR = "未分类"
DEFAULT_ENABLE_BOWL_FILTER = True
DEFAULT_SECTOR_KEYWORD = None
EXCLUDED_BOARD_PREFIXES = ("300", "301", "302", "688", "689")
PREV_VOLUME_STABLE_RATIO = 1.80
LATEST_VOLUME_TO_PREV_AVG_RATIO = 1.01
YESTERDAY_VOLUME_TO_PREV2_AVG_RATIO = 1.35
PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)

DEFAULT_SCREEN_CONFIG: dict[str, Any] = {
    "basic": {
        "min_market_value": MIN_MARKET_VALUE,
        "min_listed_days": MIN_LISTED_DAYS,
        "min_k_days": MIN_K_DAYS,
        "k_lookback_days": K_LOOKBACK_DAYS,
        "trend_k_days": TREND_K_DAYS,
        "trend_lookback_count": TREND_LOOKBACK_COUNT,
        "excluded_board_prefixes": list(EXCLUDED_BOARD_PREFIXES),
        "sector_keyword": DEFAULT_SECTOR_KEYWORD,
        "enable_listing_filter": True,
        "enable_trend_filter": True,
        "enable_k_data_filter": True,
        "enable_bowl_filter": DEFAULT_ENABLE_BOWL_FILTER,
        "enable_volume_filter": True,
    },
    "trend": {
        "min_year_pct": -0.05,
        "require_positive_slope": True,
        "require_latest_above_ma60": True,
        "ma_days": 60,
    },
    "volume": {
        "prev_volume_stable_ratio": PREV_VOLUME_STABLE_RATIO,
        "latest_volume_to_prev_avg_ratio": LATEST_VOLUME_TO_PREV_AVG_RATIO,
        "yesterday_volume_to_prev2_avg_ratio": YESTERDAY_VOLUME_TO_PREV2_AVG_RATIO,
        "require_latest_not_below_prev_max": True,
        "require_latest_above_yesterday": True,
    },
    "bowl": {
        "window_days": 30,
        "bottom_start_index": 10,
        "enable_budding_bowl": True,
        "budding_right_min_days": 2,
        "budding_right_max_days": 10,
        "budding_min_rebound_ratio": 0.05,
        "budding_max_rebound_ratio": None,
        "budding_latest_to_left_min": 0.60,
        "budding_latest_to_left_max": 1.12,
        "budding_left_to_bottom_max_days": 24,
        "enable_early_breakout": True,
        "early_right_min_days": 3,
        "early_right_max_days": 7,
        "early_min_rebound_ratio": 0.12,
        "early_latest_to_left_min": 0.85,
        "early_latest_to_left_max": 1.20,
        "early_min_latest_day_pct": 0.055,
        "enable_mature_bowl": True,
        "mature_min_rebound_ratio": 0.18,
        "mature_latest_to_left_min": 0.88,
        "mature_latest_to_left_max": 1.12,
        "mature_right_up_days_min": 4,
        "common_left_to_bottom_min_days": 3,
        "common_left_to_bottom_max_days": 18,
        "common_drop_ratio_min": 0.12,
        "common_drop_ratio_max": 0.60,
    },
}


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)


def deep_merge_config(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """递归合并配置，用户配置只需要写需要覆盖的字段。"""
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge_config(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_screen_config(config_path: str | None = None) -> dict[str, Any]:
    """加载筛选配置；未指定时读取 configs/default_bowl.json。"""
    path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
    if not path.exists():
        raise FileNotFoundError(f"筛选配置文件不存在: {path}")

    try:
        with path.open("r", encoding="utf-8") as file:
            user_config = json.load(file)
    except json.JSONDecodeError as exc:
        raise ValueError(f"筛选配置文件不是有效 JSON: {path}: {exc}") from exc

    if not isinstance(user_config, dict):
        raise ValueError(f"筛选配置文件根节点必须是 JSON 对象: {path}")

    config = deep_merge_config(DEFAULT_SCREEN_CONFIG, user_config)
    logging.info("筛选配置文件: %s", path)
    return config


def configure_network(use_proxy: bool | None = None) -> None:
    """Direct-connect domestic AKShare sources while preserving other proxies."""
    if use_proxy is True:
        return
    if use_proxy is False:
        for key in PROXY_ENV_KEYS:
            os.environ.pop(key, None)

    no_proxy_hosts = [
        "localhost", "127.0.0.1", ".qq.com", ".gtimg.cn", ".sina.com.cn",
        ".szse.cn", ".sse.com.cn", ".bse.cn", ".cninfo.com.cn",
    ]
    existing_no_proxy = os.environ.get("NO_PROXY") or os.environ.get("no_proxy")
    entries = [entry.strip() for entry in (existing_no_proxy or "").split(",") if entry.strip()]
    no_proxy = ",".join(dict.fromkeys(entries + no_proxy_hosts))
    os.environ["NO_PROXY"] = no_proxy
    os.environ["no_proxy"] = no_proxy


def today_cache_path(name: str) -> Path:
    """生成当天缓存文件路径。"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    date_text = datetime.now().strftime("%Y%m%d")
    return CACHE_DIR / f"{name}_{date_text}.csv"


def load_cached_df(cache_path: Path) -> pd.DataFrame | None:
    """读取缓存表，缓存不存在或读取失败时返回 None。"""
    if not cache_path.exists():
        return None
    try:
        df = pd.read_csv(cache_path, dtype={"代码": str, "股票代码": str})
        logging.info("使用缓存数据: %s", cache_path)
        return df
    except Exception as exc:
        logging.warning("读取缓存失败 %s: %s", cache_path, exc)
        return None


def save_cached_df(df: pd.DataFrame, cache_path: Path) -> None:
    """保存缓存表，失败时只记录日志，不影响主流程。"""
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(cache_path, index=False, encoding="utf-8-sig")
    except Exception as exc:
        logging.warning("保存缓存失败 %s: %s", cache_path, exc)


def to_float(value: Any) -> float:
    """把接口返回值转成浮点数，非法值返回 NaN。"""
    try:
        if pd.isna(value):
            return np.nan
        return float(value)
    except Exception:
        return np.nan


def normalize_symbol(symbol: Any) -> str:
    """把 A 股代码统一格式化为 6 位字符串。"""
    return str(symbol).strip().zfill(6)


def linear_slope(values: np.ndarray | pd.Series | list[float]) -> float:
    """计算短价格序列的一元线性回归斜率。"""
    y = np.asarray(values, dtype=float)
    x = np.arange(len(y), dtype=float)
    if len(y) < 2 or np.any(np.isnan(y)):
        return np.nan
    return float(np.polyfit(x, y, 1)[0])


def fetch_stock_spot_em() -> pd.DataFrame:
    """通过 AKShare 获取当日沪深京 A 股实时列表，失败时停止任务。"""
    cache_path = today_cache_path("stock_spot")
    try:
        result_df = fetch_stock_spot()
    except Exception as exc:
        raise MarketDataConnectionError(f"AKShare A 股实时列表不可用，任务已停止：{exc}") from exc
    save_cached_df(result_df, cache_path)
    return result_df


def fetch_stock_info_em(symbol: str) -> pd.DataFrame:
    """通过 AKShare 获取单只股票基础信息。"""
    try:
        return fetch_stock_info(normalize_symbol(symbol))
    except AKShareConnectionError as exc:
        raise MarketDataConnectionError(str(exc)) from exc


def fetch_stock_hist_em(
    symbol: str,
    start_date: str,
    end_date: str,
    adjust: str = "qfq",
    period: str = "daily",
) -> pd.DataFrame:
    """通过 AKShare 获取统一前复权历史 K 线。"""
    try:
        return fetch_stock_history(symbol, start_date, end_date, adjust, period)
    except AKShareConnectionError as exc:
        raise MarketDataConnectionError(str(exc)) from exc


def get_stock_universe(
    min_market_value: float = MIN_MARKET_VALUE,
    symbols: list[str] | None = None,
    sector_keyword: str | None = DEFAULT_SECTOR_KEYWORD,
    config: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """获取 A 股股票池，并先做名称、市值、停牌状态、板块等基础过滤。"""
    config = config or DEFAULT_SCREEN_CONFIG
    basic_config = config["basic"]
    excluded_board_prefixes = tuple(basic_config.get("excluded_board_prefixes") or [])
    df = fetch_stock_spot_em()
    required = {"代码", "名称", "总市值", "最新价"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"AKShare A 股股票列表缺少字段: {missing}")

    df = df.copy()
    df["代码"] = df["代码"].map(normalize_symbol)
    df["总市值"] = pd.to_numeric(df["总市值"], errors="coerce")
    df["最新价"] = pd.to_numeric(df["最新价"], errors="coerce")

    name = df["名称"].astype(str)
    df = df[
        ~name.str.contains(r"ST|\*ST|退", regex=True, na=False)
        & ~df["代码"].str.startswith(excluded_board_prefixes)
        & (df["总市值"] > min_market_value)
        & df["最新价"].notna()
        & (df["最新价"] > 0)
    ]

    if symbols:
        wanted = {normalize_symbol(symbol) for symbol in symbols}
        df = df[df["代码"].isin(wanted)]

    # Exchange listings already provide dates in bulk. Only missing metadata or
    # an explicit sector search needs a per-stock company profile request.
    enriched = []
    for profile_index, (_, row) in enumerate(df.iterrows(), start=1):
        record = row.to_dict()
        listing = record.get("上市时间")
        sector = record.get("板块")
        missing_listing = listing is None or pd.isna(listing) or not str(listing).strip()
        missing_sector = sector is None or pd.isna(sector) or not str(sector).strip()
        if missing_listing or (sector_keyword and missing_sector):
            try:
                info = stock_info_to_dict(get_stock_info(record["代码"]))
            except AKShareConnectionError as exc:
                raise MarketDataConnectionError(str(exc)) from exc
            except AKShareDataError as exc:
                logging.warning("跳过 %s：上市或行业资料不可用: %s", record["代码"], exc)
                continue
        else:
            info = {}
        if missing_listing:
            listing = info.get("上市时间")
        if missing_sector:
            sector = info.get("行业") or UNKNOWN_SECTOR
        record["上市时间"] = listing
        record["板块"] = sector
        record["概念"] = record.get("概念") or ""
        if profile_index % 50 == 0 or profile_index == len(df):
            logging.info("AKShare 股票池整理进度: %s/%s", profile_index, len(df))
        if info:
            time.sleep(SLEEP_SECONDS)
        if sector_keyword:
            text_value = "|".join(str(record.get(key) or "") for key in ("名称", "板块", "概念"))
            if str(sector_keyword).strip() not in text_value:
                continue
        enriched.append(record)
    return pd.DataFrame(enriched, columns=["代码", "名称", "总市值", "上市时间", "板块", "概念"]).reset_index(drop=True)


def result_sector(symbol: str, sector: str) -> str:
    """Fill a missing Shanghai industry only for a stock that was selected."""
    if sector and sector != UNKNOWN_SECTOR:
        return sector
    try:
        return extract_sector(get_stock_info(symbol))
    except AKShareDataError as exc:
        logging.warning("命中股票 %s 的行业资料不可用: %s", symbol, exc)
        return UNKNOWN_SECTOR


def get_listing_date(symbol: str) -> pd.Timestamp | None:
    """从 AKShare 个股信息中获取上市日期。"""
    info = get_stock_info(symbol)
    return extract_listing_date(info)


def parse_listing_date(raw: Any) -> pd.Timestamp | None:
    """解析行情资料返回的上市日期，例如 20200101。"""
    if raw is None or pd.isna(raw):
        return None

    text = str(int(raw)) if isinstance(raw, float) else str(raw).strip()
    try:
        return pd.to_datetime(text, format="%Y%m%d")
    except Exception:
        parsed = pd.to_datetime(text, errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed


def get_stock_info(symbol: str) -> pd.DataFrame:
    """按股票代码获取一只股票的 AKShare 基础信息。"""
    normalized = normalize_symbol(symbol)
    return fetch_stock_info_em(normalized)


def stock_info_to_dict(info: pd.DataFrame) -> dict[str, Any]:
    if info.empty or not {"item", "value"}.issubset(info.columns):
        return {}

    return dict(zip(info["item"].astype(str), info["value"]))


def extract_listing_date(info: pd.DataFrame) -> pd.Timestamp | None:
    """从个股信息表中提取上市日期。"""
    data = stock_info_to_dict(info)

    raw = data.get("上市时间")
    if raw is None or pd.isna(raw):
        return None

    return parse_listing_date(raw)


def extract_sector(info: pd.DataFrame) -> str:
    """从个股信息表中提取行业或板块。"""
    data = stock_info_to_dict(info)
    for key in ("行业", "所属行业", "板块", "所属板块"):
        value = data.get(key)
        if value is not None and not pd.isna(value) and str(value).strip():
            return str(value).strip()
    return UNKNOWN_SECTOR


def is_listed_over_days(
    listing_date: pd.Timestamp | None,
    min_listed_days: int = MIN_LISTED_DAYS,
) -> bool:
    """判断股票上市时间是否超过配置的天数。"""
    if listing_date is None or pd.isna(listing_date):
        return False
    return (pd.Timestamp.today().normalize() - listing_date).days > min_listed_days


def fetch_daily_k(symbol: str, lookback_days: int = K_LOOKBACK_DAYS) -> pd.DataFrame:
    """获取前复权日 K，并标准化日期和数值字段。"""
    end_date = datetime.today().strftime("%Y%m%d")
    start_date = (datetime.today() - timedelta(days=lookback_days)).strftime("%Y%m%d")

    df = fetch_stock_hist_em(
        symbol=symbol,
        period="daily",
        start_date=start_date,
        end_date=end_date,
        adjust="qfq",
    )

    if df.empty:
        return df

    required = {"日期", "开盘", "收盘", "最高", "最低", "成交量"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"stock_zh_a_hist({symbol}) 缺少字段: {missing}")

    df = df.copy()
    df["日期"] = pd.to_datetime(df["日期"], errors="coerce")
    for col in ["开盘", "收盘", "最高", "最低", "成交量"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["日期", "收盘", "最高", "最低", "成交量"])
    df = df.sort_values("日期").reset_index(drop=True)
    return df


def normalize_k_df(df: pd.DataFrame) -> pd.DataFrame:
    """标准化 K 线数据的日期和数值字段。"""
    if df.empty:
        return df

    df = df.copy()
    df["日期"] = pd.to_datetime(df["日期"], errors="coerce")
    for col in ["开盘", "收盘", "最高", "最低", "成交量"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["日期", "收盘", "最高", "最低", "成交量"])
    return df.sort_values("日期").reset_index(drop=True)


def fetch_recent_k(symbol: str, count: int) -> pd.DataFrame:
    """按交易日数量获取前复权日 K，并标准化日期和数值字段。"""
    end_date = datetime.today().strftime("%Y%m%d")
    start_date = (datetime.today() - timedelta(days=count * 2)).strftime("%Y%m%d")
    return normalize_k_df(
        fetch_stock_hist_em(
            symbol=symbol,
            period="daily",
            start_date=start_date,
            end_date=end_date,
            adjust="qfq",
        )
    )


def fetch_bottom_k(symbol: str, count: int, end_date: str) -> pd.DataFrame:
    """底部模型统一使用 AKShare 前复权日线。"""
    end = pd.Timestamp(end_date).normalize()
    df = fetch_stock_hist_em(
        symbol=symbol, period="daily", adjust="qfq",
        start_date=(end - pd.Timedelta(days=count * 2)).strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
    )
    df = completed_daily_bars(df)
    if not df.empty:
        df = df.loc[df["日期"].isna() | (df["日期"] <= end)].copy()
    return df


def fetch_akshare_qfq_history(
    symbol: str,
    start_date: str,
    end_date: str,
    adjust: str = "qfq",
    period: str = "daily",
) -> pd.DataFrame:
    """兼容旧函数名；五年行情统一由 AKShare 前复权日线接口提供。"""
    if adjust != "qfq" or period != "daily":
        raise ValueError("AKShare 长期行情仅支持前复权日线")
    try:
        result = fetch_stock_history(symbol, start_date, end_date, adjust, period)
    except AKShareConnectionError as exc:
        raise MarketDataConnectionError(str(exc)) from exc
    result["振幅"] = result.get("振幅", np.nan)
    result["涨跌幅"] = result.get("涨跌幅", np.nan)
    result["涨跌额"] = result.get("涨跌额", np.nan)
    return completed_daily_bars(result)


def check_sideways_candidate(symbol: str, short_bars: pd.DataFrame,
                             listing_date: pd.Timestamp | None, config: dict[str, Any]):
    """仅在旧模型判定为横盘后调用；长期数据异常不影响转强分支。"""
    as_of = pd.Timestamp(short_bars["日期"].iloc[-1]).strftime("%Y-%m-%d")
    start = pd.Timestamp(as_of) - pd.DateOffset(years=config["sideways"]["history_years"])
    if listing_date is None or pd.isna(listing_date) or pd.Timestamp(listing_date) > start:
        return evaluate_sideways(pd.DataFrame(), listing_date, as_of, config)
    try:
        history = fetch_sideways_history(symbol, as_of, config, fetch_akshare_qfq_history, CACHE_DIR)
        # 防止两个行情源日期不齐或复权不一致；统一比例缩放不影响模型指标。
        overlap = short_bars.tail(45).merge(history, on="日期", suffixes=("_short", "_long"))
        if len(overlap) != 45:
            raise HistoryDataError("长短行情最近45日不对齐")
        scale = float(overlap["收盘_long"].iloc[-1]) / float(overlap["收盘_short"].iloc[-1])
        for field in ("开盘", "收盘", "最高", "最低"):
            if not np.allclose(overlap[f"{field}_short"].astype(float) * scale,
                               overlap[f"{field}_long"].astype(float), rtol=.002, atol=.01):
                raise HistoryDataError("长短行情价格或复权口径不一致")
        return evaluate_sideways(history, listing_date, as_of, config)
    except Exception as exc:
        if is_market_data_connection_error(exc):
            raise MarketDataConnectionError(
                f"长期行情接口不可用，任务已停止（{symbol}）：{exc}"
            ) from exc
        logging.warning("长期行情未验证 %s: %s", symbol, exc)
        return False, {"规则版本": config["sideways"]["version"], "未通过环节": "长期数据",
                       "未通过原因": str(exc), "未验证": True}


def is_one_year_uptrend(
    df: pd.DataFrame,
    config: dict[str, Any] | None = None,
) -> tuple[bool, dict[str, float]]:
    """判断近一年走势是否整体向上。"""
    config = config or DEFAULT_SCREEN_CONFIG
    basic_config = config["basic"]
    trend_config = config["trend"]
    trend_k_days = int(basic_config["trend_k_days"])
    ma_days = int(trend_config["ma_days"])

    if len(df) < trend_k_days:
        return False, {}

    close = df["收盘"].iloc[-trend_k_days:].to_numpy(dtype=float)
    if np.any(np.isnan(close)) or close[0] <= 0:
        return False, {}

    pct = float(close[-1] / close[0] - 1)
    slope = linear_slope(close)
    if len(close) < ma_days:
        return False, {}
    ma_value = float(np.mean(close[-ma_days:]))
    latest_close = float(close[-1])

    metrics = {
        "最近一年涨跌幅": round(pct * 100, 2),
        "最近一年收盘价斜率": float(slope),
        "最新价相对60日均线": round((latest_close / ma_value - 1) * 100, 2) if ma_value > 0 else np.nan,
    }
    checks = [
        pct > float(trend_config["min_year_pct"]),
        slope > 0 if trend_config["require_positive_slope"] else True,
        latest_close > ma_value if trend_config["require_latest_above_ma60"] else True,
    ]
    return all(checks), metrics


def is_volume_breakout(
    volumes: pd.Series,
    config: dict[str, Any] | None = None,
) -> tuple[bool, dict[str, float]]:
    """判断前三天未明显放量，且最新一天量能略高于前三天水平。"""
    config = config or DEFAULT_SCREEN_CONFIG
    volume_config = config["volume"]
    if len(volumes) < 4:
        return False, {}
    v = volumes.iloc[-4:].to_numpy(dtype=float)
    if np.any(np.isnan(v)) or np.any(v <= 0):
        return False, {}

    prev3 = v[:3]
    latest = float(v[-1])
    prev_avg = float(np.mean(prev3))
    prev_max = float(np.max(prev3))
    prev_min = float(np.min(prev3))
    prev2_avg = float(np.mean(v[:2]))
    yesterday_to_prev2_avg = float(v[2] / prev2_avg)
    prev_stable_ratio = prev_max / prev_min
    latest_to_prev_avg = latest / prev_avg
    latest_to_prev_max = latest / prev_max

    metrics = {
        "前三日成交量稳定比": round(prev_stable_ratio, 4),
        "昨日量/前两日均量": round(yesterday_to_prev2_avg, 4),
        "最新量/前三日均量": round(latest_to_prev_avg, 4),
        "最新量/前三日最大量": round(latest_to_prev_max, 4),
    }

    checks = [
        prev_stable_ratio <= float(volume_config["prev_volume_stable_ratio"]),
        yesterday_to_prev2_avg <= float(volume_config["yesterday_volume_to_prev2_avg_ratio"]),
        latest_to_prev_avg >= float(volume_config["latest_volume_to_prev_avg_ratio"]),
        latest >= prev_max if volume_config["require_latest_not_below_prev_max"] else True,
        latest > prev3[-1] if volume_config["require_latest_above_yesterday"] else True,
    ]
    return all(checks), metrics


def is_bowl_shape(
    df: pd.DataFrame,
    config: dict[str, Any] | None = None,
) -> tuple[bool, dict[str, float]]:
    """判断最近约 30 个交易日是否呈现“左沿、回踩筑底、右沿回升”的碗型。"""
    config = config or DEFAULT_SCREEN_CONFIG
    bowl_config = config["bowl"]
    window_days = int(bowl_config["window_days"])
    if len(df) < window_days:
        return False, {}

    window = df.iloc[-window_days:].reset_index(drop=True)
    close = window["收盘"].to_numpy(dtype=float)
    high = window["最高"].to_numpy(dtype=float)
    low = window["最低"].to_numpy(dtype=float)

    if np.any(np.isnan(close)) or np.any(np.isnan(high)) or np.any(np.isnan(low)):
        return False, {}

    latest_close = float(close[-1])
    best_metrics: dict[str, float] = {}

    for bottom_idx in range(
        int(bowl_config["bottom_start_index"]),
        len(window) - int(bowl_config["budding_right_min_days"]) + 1,
    ):
        left_high_idx = int(np.argmax(high[:bottom_idx]))
        left_high = float(high[left_high_idx])
        bottom_low = float(low[bottom_idx])

        if left_high <= 0 or bottom_low <= 0:
            continue

        left_to_bottom_days = bottom_idx - left_high_idx
        drop_ratio = left_high / bottom_low - 1
        rebound_ratio = latest_close / bottom_low - 1
        latest_to_left_high = latest_close / left_high
        right_close = close[bottom_idx:]
        right_len = len(right_close)
        right_slope = linear_slope(right_close)
        right_recent_up_days = int(np.sum(np.diff(right_close[-5:]) > 0)) if len(right_close) >= 2 else 0
        right_up_days = int(np.sum(np.diff(right_close[-8:]) > 0)) if len(right_close) >= 8 else 0
        right_max_single_day = (
            float(np.max(np.diff(right_close) / right_close[:-1]))
            if len(right_close) >= 2 and np.all(right_close[:-1] > 0)
            else np.nan
        )
        ma5 = float(np.mean(close[-5:]))
        latest_to_ma5 = latest_close / ma5 if ma5 > 0 else np.nan
        latest_day_pct = (
            float(close[-1] / close[-2] - 1)
            if len(close) >= 2 and close[-2] > 0
            else np.nan
        )
        budding_max_rebound_ratio = bowl_config.get("budding_max_rebound_ratio")
        if budding_max_rebound_ratio is None:
            budding_rebound_not_too_high = True
        else:
            budding_rebound_not_too_high = rebound_ratio <= float(budding_max_rebound_ratio)

        budding_bowl = (
            bool(bowl_config.get("enable_budding_bowl", True))
            and int(bowl_config["budding_right_min_days"]) <= right_len <= int(bowl_config["budding_right_max_days"])
            and right_slope > 0
            and rebound_ratio >= float(bowl_config["budding_min_rebound_ratio"])
            and budding_rebound_not_too_high
            and float(bowl_config["budding_latest_to_left_min"])
            <= latest_to_left_high
            <= float(bowl_config["budding_latest_to_left_max"])
            and right_recent_up_days >= 1
            and latest_close >= ma5
        )
        early_breakout = (
            bool(bowl_config.get("enable_early_breakout", True))
            and int(bowl_config["early_right_min_days"]) <= right_len <= int(bowl_config["early_right_max_days"])
            and right_slope > 0
            and rebound_ratio >= float(bowl_config["early_min_rebound_ratio"])
            and float(bowl_config["early_latest_to_left_min"])
            <= latest_to_left_high
            <= float(bowl_config["early_latest_to_left_max"])
            and latest_day_pct >= float(bowl_config["early_min_latest_day_pct"])
            and latest_close >= float(np.max(right_close[:-1]))
        )
        mature_bowl = (
            bool(bowl_config.get("enable_mature_bowl", True))
            and right_slope > 0
            and right_up_days >= int(bowl_config["mature_right_up_days_min"])
            and bottom_idx <= len(window) - 5
        )
        if budding_bowl:
            rebound_ratio_min = float(bowl_config["budding_min_rebound_ratio"])
            latest_to_left_high_lower = float(bowl_config["budding_latest_to_left_min"])
            latest_to_left_high_upper = float(bowl_config["budding_latest_to_left_max"])
            left_to_bottom_days_upper = int(bowl_config["budding_left_to_bottom_max_days"])
            bowl_stage = "右侧萌芽"
        elif early_breakout:
            rebound_ratio_min = float(bowl_config["early_min_rebound_ratio"])
            latest_to_left_high_lower = float(bowl_config["early_latest_to_left_min"])
            latest_to_left_high_upper = float(bowl_config["early_latest_to_left_max"])
            left_to_bottom_days_upper = int(bowl_config["common_left_to_bottom_max_days"])
            bowl_stage = "早期启动"
        elif mature_bowl:
            rebound_ratio_min = float(bowl_config["mature_min_rebound_ratio"])
            latest_to_left_high_lower = float(bowl_config["mature_latest_to_left_min"])
            latest_to_left_high_upper = float(bowl_config["mature_latest_to_left_max"])
            left_to_bottom_days_upper = int(bowl_config["common_left_to_bottom_max_days"])
            bowl_stage = "成熟碗型"
        else:
            rebound_ratio_min = float(bowl_config["mature_min_rebound_ratio"])
            latest_to_left_high_lower = float(bowl_config["mature_latest_to_left_min"])
            latest_to_left_high_upper = float(bowl_config["mature_latest_to_left_max"])
            left_to_bottom_days_upper = int(bowl_config["common_left_to_bottom_max_days"])
            bowl_stage = "未通过"

        checks = [
            int(bowl_config["common_left_to_bottom_min_days"])
            <= left_to_bottom_days
            <= left_to_bottom_days_upper,
            float(bowl_config["common_drop_ratio_min"]) <= drop_ratio <= float(bowl_config["common_drop_ratio_max"]),
            rebound_ratio >= rebound_ratio_min,
            latest_to_left_high_lower <= latest_to_left_high <= latest_to_left_high_upper,
            budding_bowl or early_breakout or mature_bowl,
        ]

        metrics = {
            "碗型窗口天数": float(window_days),
            "碗型阶段": bowl_stage,
            "碗型左沿位置": float(left_high_idx + 1),
            "碗型底部位置": float(bottom_idx + 1),
            "碗型左沿最高价": left_high,
            "碗型底部最低价": bottom_low,
            "碗型回踩幅度": round(drop_ratio * 100, 2),
            "碗型反弹幅度": round(rebound_ratio * 100, 2),
            "最新价/左沿高点": round(latest_to_left_high, 4),
            "右侧收盘价斜率": float(right_slope),
            "右侧近5日上涨天数": float(right_recent_up_days),
            "右侧近8日上涨天数": float(right_up_days),
            "右侧最大单日涨幅": round(right_max_single_day * 100, 2),
            "右侧交易日数": float(right_len),
            "最新价/5日均线": round(latest_to_ma5, 4),
            "最新日涨幅": round(latest_day_pct * 100, 2),
            "右侧萌芽碗型": "是" if budding_bowl else "否",
            "早期启动碗型": "是" if early_breakout else "否",
        }

        if all(checks):
            return True, metrics

        if not best_metrics or drop_ratio > best_metrics.get("碗型回踩幅度", 0) / 100:
            best_metrics = metrics

    if best_metrics:
        return False, best_metrics

    latest_close = float(close[-1])
    low_idx = int(np.argmin(low))
    mid_low = float(np.min(low))
    if mid_low <= 0:
        return False, {}

    fallback_metrics = {
        "碗型窗口天数": 30.0,
        "碗型底部位置": float(low_idx + 1),
        "碗型底部最低价": mid_low,
        "碗型反弹幅度": round((latest_close / mid_low - 1) * 100, 2),
    }
    return False, fallback_metrics


def build_result_row(
    item: pd.Series,
    listing_date: pd.Timestamp | None,
    sector: str,
    k_df: pd.DataFrame,
    metrics: dict[str, float],
    enable_bowl_filter: bool,
    sector_keyword: str | None,
) -> dict[str, Any]:
    """构造一行筛选结果。"""
    last15 = k_df.iloc[-15:]
    pct_15 = (
        float(last15["收盘"].iloc[-1] / last15["收盘"].iloc[0] - 1)
        if len(last15) >= 2 and float(last15["收盘"].iloc[0]) > 0
        else np.nan
    )
    vols = k_df["成交量"].iloc[-4:].astype(float).tolist()
    vols = [np.nan] * (4 - len(vols)) + vols
    market_value = to_float(item["总市值"])
    listing_date_text = (
        listing_date.strftime("%Y-%m-%d")
        if listing_date is not None and not pd.isna(listing_date)
        else "—"
    )
    latest_trade_date = (
        k_df["日期"].iloc[-1].strftime("%Y-%m-%d") if not k_df.empty else "—"
    )

    def serialize_volume(value: float) -> int | None:
        return int(value) if not pd.isna(value) else None

    return {
        "股票代码": normalize_symbol(item["代码"]),
        "股票名称": str(item["名称"]),
        "板块": sector or UNKNOWN_SECTOR,
        "上市时间": listing_date_text,
        "总市值": market_value,
        "总市值_亿元": round(market_value / 100_000_000, 2),
        "最近15日涨跌幅": round(pct_15 * 100, 2),
        "最新成交量": serialize_volume(vols[-1]),
        "前一日成交量": serialize_volume(vols[-2]),
        "前二日成交量": serialize_volume(vols[-3]),
        "前三日成交量": serialize_volume(vols[-4]),
        "最新交易日": latest_trade_date,
        "板块关键词": sector_keyword or "全部",
        "是否启用碗型过滤": "是" if enable_bowl_filter else "否",
        **metrics,
    }


def log_filter_stats(stats: dict[str, int], *, is_bottom: bool = False) -> None:
    """两个模型共用统计格式，仅按实际筛选流程选择统计项。"""
    keys = ["基础过滤后待扫描", "上市时间不足/缺失", "上市时间通过"]
    if not is_bottom:
        keys.extend(["一年趋势不通过", "一年趋势通过"])
    keys.extend(["K线数据不足", "K线数据通过"])
    if is_bottom:
        keys.extend(["底部平台不通过", "底部平台通过"])
        for stage in SIDEWAYS_STAGES:
            keys.extend([f"{stage}不通过", f"{stage}通过"])
        keys.extend(["长期数据未验证", "横盘未突破", "出现转强"])
    else:
        keys.extend(["成交量不通过", "成交量通过", "碗型不通过", "碗型通过"])
    keys.extend(["接口异常/其他异常", "最终命中"])

    logging.info("========== 筛选统计 ==========")
    for key in keys:
        logging.info("%s: %s", key, stats[key])
    logging.info("========== 统计结束 ==========")


def screen_stocks(
    symbols: list[str] | None = None,
    min_market_value: float | None = None,
    min_listed_days: int | None = None,
    min_k_days: int | None = None,
    sleep_seconds: float = SLEEP_SECONDS,
    enable_bowl_filter: bool | None = None,
    sector_keyword: str | None = None,
    config: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """执行完整筛选流程。"""
    config = config or DEFAULT_SCREEN_CONFIG
    basic_config = config["basic"]
    is_bottom = config.get("model_type") == "bottom"
    min_market_value = float(min_market_value if min_market_value is not None else basic_config["min_market_value"])
    min_listed_days = int(min_listed_days if min_listed_days is not None else basic_config["min_listed_days"])
    min_k_days = int(min_k_days if min_k_days is not None else basic_config["min_k_days"])
    k_lookback_days = int(basic_config["k_lookback_days"])
    trend_lookback_count = int(basic_config["trend_lookback_count"])
    enable_bowl_filter = (
        bool(enable_bowl_filter)
        if enable_bowl_filter is not None
        else bool(basic_config["enable_bowl_filter"])
    )
    if sector_keyword is None:
        sector_keyword = basic_config.get("sector_keyword")
    enable_listing_filter = bool(
        basic_config.get("enable_listing_filter", True)
    )
    enable_trend_filter = bool(basic_config.get("enable_trend_filter", True))
    enable_k_data_filter = bool(
        basic_config.get("enable_k_data_filter", True)
    )

    universe = get_stock_universe(
        min_market_value=min_market_value,
        symbols=symbols,
        sector_keyword=sector_keyword,
        config=config,
    )
    logging.info("基础过滤后股票数: %s", len(universe))
    logging.info("板块关键词过滤: %s", sector_keyword or "关闭")
    logging.info("排除代码前缀: %s", ",".join(basic_config.get("excluded_board_prefixes") or []) or "关闭")
    logging.info("上市时间要求: 超过 %s 天", min_listed_days)
    logging.info("上市时间过滤: %s", "启用" if enable_listing_filter else "关闭")
    if is_bottom:
        logging.info("K 线数据过滤: 启用")
        logging.info("底部平台过滤: 启用")
        logging.info("K 线最少条数: %s，默认回看交易日: %s", config["bottom"]["year_days"], trend_lookback_count)
    else:
        logging.info("一年趋势过滤: %s", "启用" if enable_trend_filter else "关闭")
        logging.info("K 线数据过滤: %s", "启用" if enable_k_data_filter else "关闭")
        logging.info("成交量过滤: %s", "启用" if basic_config.get("enable_volume_filter", True) else "关闭")
        logging.info("碗型过滤: %s", "启用" if enable_bowl_filter else "关闭")
        logging.info("K 线最少条数: %s，默认回看交易日: %s", min_k_days, k_lookback_days)

    rows: list[dict[str, Any]] = []
    stats = {
        "基础过滤后待扫描": len(universe),
        "上市时间不足/缺失": 0,
        "上市时间通过": 0,
        "一年趋势不通过": 0,
        "一年趋势通过": 0,
        "K线数据不足": 0,
        "K线数据通过": 0,
        "成交量不通过": 0,
        "成交量通过": 0,
        "碗型不通过": 0,
        "碗型通过": 0,
        "接口异常/其他异常": 0,
        "最终命中": 0,
    }

    if is_bottom:
        stats.update({"底部平台不通过": 0, "底部平台通过": 0, "横盘未突破": 0, "出现转强": 0, "长期数据未验证": 0})
        for stage in SIDEWAYS_STAGES:
            stats.update({f"{stage}不通过": 0, f"{stage}通过": 0})

    for i, item in universe.iterrows():
        symbol = normalize_symbol(item["代码"])
        name = str(item["名称"])

        try:
            listing_date = parse_listing_date(item.get("上市时间"))
            listing_ok = is_listed_over_days(
                listing_date,
                min_listed_days=min_listed_days,
            )
            if enable_listing_filter and not listing_ok:
                stats["上市时间不足/缺失"] += 1
                continue
            stats["上市时间通过"] += 1
            sector = str(item.get("板块") or UNKNOWN_SECTOR).strip() or UNKNOWN_SECTOR

            if is_bottom:
                end_date = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
                trend_df = fetch_bottom_k(symbol, trend_lookback_count, end_date)
                ok, metrics = evaluate_bottom(trend_df, config)
                insufficient_k = len(trend_df) < int(config["bottom"]["year_days"])
                stats["K线数据不足" if insufficient_k else "K线数据通过"] += 1
                if not ok:
                    if not insufficient_k:
                        stats["底部平台不通过"] += 1
                    logging.debug("跳过 %s %s: %s", symbol, name, metrics["未通过原因"])
                    continue
                stats["底部平台通过"] += 1
                if metrics["碗型阶段"] == "横盘未突破":
                    sideways_ok, sideways_metrics = check_sideways_candidate(symbol, trend_df, listing_date, config)
                    failed_stage = sideways_metrics.get("未通过环节")
                    for stage in SIDEWAYS_STAGES:
                        if stage == failed_stage:
                            key = "长期数据未验证" if sideways_metrics.get("未验证") else f"{stage}不通过"
                            stats[key] += 1
                            break
                        stats[f"{stage}通过"] += 1
                    if not sideways_ok:
                        logging.debug("跳过 %s %s: %s", symbol, name, sideways_metrics["未通过原因"])
                        continue
                    metrics.update(sideways_metrics)
                else:
                    metrics["规则版本"] = "bottom_v1_strength"
                rows.append(build_result_row(item, listing_date, result_sector(symbol, sector), trend_df, metrics, False, sector_keyword))
                stats[metrics["碗型阶段"]] += 1
                stats["最终命中"] += 1
                logging.info("命中: %s %s", symbol, name)
                continue
            trend_df = fetch_recent_k(symbol, trend_lookback_count)
            trend_ok, trend_metrics = is_one_year_uptrend(trend_df, config=config)
            if enable_trend_filter and not trend_ok:
                stats["一年趋势不通过"] += 1
                continue
            stats["一年趋势通过"] += 1

            k_df = trend_df.iloc[-max(k_lookback_days, min_k_days):].copy()
            if enable_k_data_filter and len(k_df) < min_k_days:
                stats["K线数据不足"] += 1
                continue
            stats["K线数据通过"] += 1

            volume_metrics: dict[str, float] = {}
            if basic_config.get("enable_volume_filter", True):
                volume_ok, volume_metrics = is_volume_breakout(k_df["成交量"], config=config)
                if not volume_ok:
                    stats["成交量不通过"] += 1
                    continue
                stats["成交量通过"] += 1
            else:
                stats["成交量通过"] += 1

            metrics: dict[str, float] = {**trend_metrics, **volume_metrics}
            # 默认启用碗型过滤；需要临时关闭时，运行脚本加 --disable-bowl-filter。
            if enable_bowl_filter:
                ok, bowl_metrics = is_bowl_shape(k_df, config=config)
                metrics.update(bowl_metrics)
                if not ok:
                    stats["碗型不通过"] += 1
                    continue
                stats["碗型通过"] += 1

            rows.append(
                build_result_row(
                    item,
                    listing_date,
                    result_sector(symbol, sector),
                    k_df,
                    metrics,
                    enable_bowl_filter,
                    sector_keyword,
                )
            )
            stats["最终命中"] += 1
            logging.info("命中: %s %s", symbol, name)

        except Exception as exc:
            if is_market_data_connection_error(exc):
                raise MarketDataConnectionError(
                    f"行情接口连接失败，任务已停止（{symbol} {name}）：{exc}"
                ) from exc
            stats["接口异常/其他异常"] += 1
            logging.warning("跳过 %s %s: %s", symbol, name, exc)

        finally:
            if i % 50 == 0:
                logging.info("进度: %s/%s", i + 1, len(universe))
            time.sleep(sleep_seconds)

    log_filter_stats(stats, is_bottom=is_bottom)
    result = pd.DataFrame(rows)
    if is_bottom:
        result.attrs["model_type"] = "bottom"
    return result


def build_default_output_path() -> str:
    """生成 data 目录下带时间戳的默认 Excel 路径。"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return str(Path(OUTPUT_DIR) / f"bowl_shape_by_sector_{timestamp}.xlsx")


def normalize_excel_output_path(output_path: str) -> str:
    """确保输出路径使用 xlsx 后缀。"""
    output = Path(output_path)
    if output.suffix.lower() != ".xlsx":
        output = output.with_suffix(".xlsx")
    return str(output)


def build_run_timestamp() -> str:
    """生成用于报告记录的运行时间戳。"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def cleanup_cache_dir() -> None:
    """清理临时缓存；股票池缓存仅用于审计，不能替代实时列表。"""
    if not CACHE_DIR.exists():
        return

    today_spot = today_cache_path("stock_spot")
    preserved = {today_spot} if today_spot.exists() else set()
    removed_count = 0
    for path in CACHE_DIR.iterdir():
        if path.is_file() and path not in preserved:
            path.unlink()
            removed_count += 1

    try:
        CACHE_DIR.rmdir()
    except OSError:
        pass

    logging.info(
        "已清理缓存文件 %s 个，保留当日股票池审计缓存 %s 个",
        removed_count,
        len(preserved),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="筛选近一年上升趋势、碗型走线且成交量突增的 A 股股票")
    parser.add_argument(
        "--config",
        default=None,
        help="筛选配置 JSON 路径；默认读取 configs/default_bowl.json",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="输出 Excel 路径；默认保存到 data/bowl_shape_by_sector_YYYYMMDD_HHMMSS.xlsx",
    )
    parser.add_argument(
        "--symbols",
        nargs="*",
        help="只扫描指定股票代码，例如: --symbols 000001 600519 300750",
    )
    parser.add_argument(
        "--min-market-value",
        type=float,
        default=None,
        help="最小总市值，单位元；不传则使用配置文件",
    )
    parser.add_argument(
        "--sector-keyword",
        default=None,
        help="板块/名称/概念关键词；不传则使用配置文件",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=SLEEP_SECONDS,
        help="每次接口请求后的暂停秒数",
    )
    parser.add_argument(
        "--enable-bowl-filter",
        action="store_true",
        help="启用碗型过滤；当前默认已启用，保留该参数用于兼容旧命令",
    )
    parser.add_argument(
        "--disable-bowl-filter",
        action="store_true",
        help="关闭碗型过滤，只按基础条件、上市天数、一年趋势和成交量过滤",
    )
    parser.add_argument(
        "--use-proxy",
        action="store_true",
        help="让行情接口也使用当前终端的 HTTP/HTTPS 代理",
    )
    parser.add_argument(
        "--no-proxy",
        action="store_true",
        help="忽略当前终端的 HTTP/HTTPS 代理环境变量",
    )
    return parser.parse_args()


def run_screening(
    config_path: str | None = None,
    config_overrides: dict[str, Any] | None = None,
    output: str | None = None,
    symbols: list[str] | None = None,
    min_market_value: float | None = None,
    sector_keyword: str | None = None,
    sleep_seconds: float = SLEEP_SECONDS,
    enable_bowl_filter: bool | None = None,
    use_proxy: bool | None = None,
) -> pd.DataFrame:
    """按指定配置执行筛选、导出 Excel，并返回结果表。"""
    configure_network(use_proxy=use_proxy)
    logging.info("行情接口：AKShare %s", akshare_version())
    config = load_screen_config(config_path)
    if config_overrides:
        config = deep_merge_config(config, config_overrides)
    output_path = normalize_excel_output_path(output or build_default_output_path())
    try:
        run_started_at = build_run_timestamp()
        result = screen_stocks(
            symbols=symbols,
            min_market_value=min_market_value,
            sleep_seconds=sleep_seconds,
            enable_bowl_filter=enable_bowl_filter,
            sector_keyword=sector_keyword,
            config=config,
        )
        run_finished_at = build_run_timestamp()
        export_sector_summary_excel(
            result,
            output_path,
            started_at=run_started_at,
            finished_at=run_finished_at,
        )
        cleanup_cache_dir()
        logging.info(
            "完成，命中 %s 只，板块汇总 Excel 已保存到 %s",
            len(result),
            output_path,
        )
        return result
    except Exception as exc:
        logging.error("运行失败: %s", exc)
        logging.error(
            "请检查 AKShare 行情接口与网络/代理配置。国内行情源默认直连；需要代理时可尝试 --use-proxy。"
        )
        raise SystemExit(1) from exc


def main() -> None:
    args = parse_args()
    sector_keyword = args.sector_keyword.strip() if args.sector_keyword else None
    enable_bowl_filter: bool | None = True if args.enable_bowl_filter else None
    if args.disable_bowl_filter:
        enable_bowl_filter = False

    run_screening(
        config_path=args.config,
        output=args.output,
        symbols=args.symbols,
        min_market_value=args.min_market_value,
        sector_keyword=sector_keyword,
        sleep_seconds=args.sleep,
        enable_bowl_filter=enable_bowl_filter,
        use_proxy=False if args.no_proxy else True if args.use_proxy else None,
    )


if __name__ == "__main__":
    main()
