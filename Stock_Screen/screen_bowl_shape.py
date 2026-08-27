from __future__ import annotations

import argparse
import copy
import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, TypeVar

import numpy as np
import pandas as pd
import requests

from excel_exporter import export_sector_summary_excel


T = TypeVar("T")

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
MAX_REQUEST_RETRIES = 3
STOCK_LIST_NODE_ROUNDS = 2
STOCK_LIST_RETRY_BASE_SECONDS = 1.0
DEFAULT_ENABLE_BOWL_FILTER = True
DEFAULT_SECTOR_KEYWORD = None
EXCLUDED_BOARD_PREFIXES = ("300", "301", "302", "688", "689")
PREV_VOLUME_STABLE_RATIO = 1.80
LATEST_VOLUME_TO_PREV_AVG_RATIO = 1.01
YESTERDAY_VOLUME_TO_PREV2_AVG_RATIO = 1.35
EASTMONEY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0 Safari/537.36"
    ),
    "Referer": "https://quote.eastmoney.com/center/gridlist.html",
    "Accept": "application/json,text/plain,*/*",
    "Connection": "close",
}
EASTMONEY_STOCK_LIST_URLS = (
    "https://82.push2.eastmoney.com/api/qt/clist/get",
    "https://push2.eastmoney.com/api/qt/clist/get",
    "https://push2delay.eastmoney.com/api/qt/clist/get",
    "http://82.push2.eastmoney.com/api/qt/clist/get",
    "http://push2.eastmoney.com/api/qt/clist/get",
    "http://push2delay.eastmoney.com/api/qt/clist/get",
)
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


def configure_network(use_proxy: bool = False) -> None:
    """默认避开可能失效的系统代理，除非用户显式要求使用代理。"""
    if use_proxy:
        return

    for key in PROXY_ENV_KEYS:
        os.environ.pop(key, None)

    no_proxy_hosts = [
        "localhost",
        "127.0.0.1",
        "*.eastmoney.com",
        "eastmoney.com",
        "*.akshare.xyz",
        "akshare.xyz",
    ]
    existing_no_proxy = os.environ.get("NO_PROXY") or os.environ.get("no_proxy")
    if existing_no_proxy:
        no_proxy_hosts.insert(0, existing_no_proxy)

    no_proxy = ",".join(no_proxy_hosts)
    os.environ["NO_PROXY"] = no_proxy
    os.environ["no_proxy"] = no_proxy


def call_with_retries(
    func: Callable[[], T],
    description: str,
    max_retries: int = MAX_REQUEST_RETRIES,
    sleep_seconds: float = 2.0,
) -> T:
    """对不稳定的东方财富请求做重试，最后仍失败时再抛出错误。"""
    last_exc: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            return func()
        except Exception as exc:
            last_exc = exc
            if attempt >= max_retries:
                break
            logging.warning(
                "%s 失败，第 %s/%s 次重试: %s",
                description,
                attempt,
                max_retries,
                exc,
            )
            time.sleep(sleep_seconds * (2 ** (attempt - 1)))

    raise RuntimeError(f"{description} 连续失败 {max_retries} 次: {last_exc}") from last_exc


def eastmoney_get_json(
    url: str,
    params: dict[str, Any],
    description: str,
    timeout: float = 15,
    max_retries: int = MAX_REQUEST_RETRIES,
) -> dict[str, Any]:
    """使用接近浏览器的请求头访问东方财富 JSON 接口。"""

    def request_once() -> dict[str, Any]:
        with requests.Session() as session:
            session.trust_env = False
            response = session.get(
                url,
                params=params,
                headers=EASTMONEY_HEADERS,
                timeout=timeout,
            )
            response.raise_for_status()
            return response.json()

    return call_with_retries(request_once, description, max_retries=max_retries)


def generic_get_json(
    url: str,
    description: str,
    timeout: float = 15,
    max_retries: int = MAX_REQUEST_RETRIES,
) -> dict[str, Any]:
    """访问普通 JSON 接口，用于非东方财富备用数据源。"""

    def request_once() -> dict[str, Any]:
        with requests.Session() as session:
            session.trust_env = False
            response = session.get(url, headers=EASTMONEY_HEADERS, timeout=timeout)
            response.raise_for_status()
            return response.json()

    return call_with_retries(request_once, description, max_retries=max_retries)


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


def get_market_code(symbol: str) -> int:
    """东方财富市场代码：沪市为 1，深市和北交所这里按 0 处理。"""
    return 1 if normalize_symbol(symbol).startswith("6") else 0


def fetch_stock_list_page(
    params: dict[str, Any],
    page: int,
    preferred_url: str | None = None,
    urls: tuple[str, ...] = EASTMONEY_STOCK_LIST_URLS,
    node_rounds: int = STOCK_LIST_NODE_ROUNDS,
) -> tuple[dict[str, Any], str]:
    """逐节点抓取一页股票列表，当前节点失败时自动切换备用节点。"""
    ordered_urls = list(urls)
    if preferred_url in ordered_urls:
        ordered_urls.remove(preferred_url)
        ordered_urls.insert(0, preferred_url)

    description = f"获取 A 股股票列表第 {page} 页"
    errors: list[str] = []
    for round_index in range(node_rounds):
        for candidate_url in ordered_urls:
            try:
                page_json = eastmoney_get_json(
                    candidate_url,
                    params,
                    description,
                    timeout=10,
                    max_retries=1,
                )
                page_data = page_json.get("data")
                if not isinstance(page_data, dict):
                    raise RuntimeError("响应缺少 data 对象")
                page_records = page_data.get("diff")
                if not isinstance(page_records, list) or not page_records:
                    raise RuntimeError("响应缺少有效股票记录")
                if preferred_url and candidate_url != preferred_url:
                    logging.warning(
                        "%s 已从 %s 切换到 %s",
                        description,
                        preferred_url,
                        candidate_url,
                    )
                return page_json, candidate_url
            except Exception as exc:
                errors.append(f"{candidate_url}: {exc}")
                logging.warning(
                    "%s 节点失败（第 %s/%s 轮）%s: %s",
                    description,
                    round_index + 1,
                    node_rounds,
                    candidate_url,
                    exc,
                )

        if round_index + 1 < node_rounds:
            wait_seconds = STOCK_LIST_RETRY_BASE_SECONDS * (2 ** round_index)
            logging.warning(
                "%s 所有节点暂时不可用，%.1f 秒后重试",
                description,
                wait_seconds,
            )
            time.sleep(wait_seconds)

    recent_errors = " | ".join(errors[-len(ordered_urls):])
    raise RuntimeError(
        f"{description} 的所有节点连续失败 {node_rounds} 轮: {recent_errors}"
    )


def fetch_stock_spot_em() -> pd.DataFrame:
    """从东方财富获取沪深京 A 股实时列表。"""
    cache_path = today_cache_path("stock_spot")
    base_params = {
        "pn": "1",
        "pz": "100",
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f12",
        "fs": "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048",
        "fields": "f2,f12,f14,f20,f26,f100,f103",
    }

    try:
        first_json, active_url = fetch_stock_list_page(
            base_params,
            page=1,
        )
        logging.info("A 股股票列表接口使用: %s", active_url)

        data = first_json["data"]
        diff = data["diff"]
        total = int(data.get("total") or len(diff))
        page_size = int(base_params["pz"])
        total_pages = max(1, int(np.ceil(total / page_size)))

        records = list(diff)
        for page in range(2, total_pages + 1):
            params = base_params.copy()
            params["pn"] = str(page)
            page_json, active_url = fetch_stock_list_page(
                params,
                page=page,
                preferred_url=active_url,
            )
            records.extend(page_json["data"]["diff"])
            time.sleep(0.2)
    except Exception as exc:
        cached_df = load_cached_df(cache_path)
        if cached_df is not None:
            logging.warning("实时股票列表抓取失败，改用当日缓存: %s", exc)
            return cached_df
        raise RuntimeError(
            f"所有 A 股股票列表节点均失败，且没有可用的当日缓存: {exc}"
        ) from exc

    records_by_code: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        stock_code = str(record.get("f12") or "").strip()
        if stock_code:
            records_by_code[stock_code] = record

    df = pd.DataFrame(records_by_code.values())
    if df.empty:
        result_df = pd.DataFrame(columns=["代码", "名称", "最新价", "总市值", "上市时间", "板块", "概念"])
    else:
        result_df = pd.DataFrame(
        {
            "代码": df.get("f12"),
            "名称": df.get("f14"),
            "最新价": df.get("f2"),
            "总市值": df.get("f20"),
            "上市时间": df.get("f26"),
            "板块": df.get("f100"),
            "概念": df.get("f103"),
        }
    )
    save_cached_df(result_df, cache_path)
    return result_df


def fetch_stock_info_em(symbol: str) -> pd.DataFrame:
    """从东方财富获取单只股票的基础信息。"""
    normalized = normalize_symbol(symbol)
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    params = {
        "fltt": "2",
        "invt": "2",
        "fields": "f57,f58,f84,f85,f127,f116,f117,f189,f43",
        "secid": f"{get_market_code(normalized)}.{normalized}",
    }
    data_json = eastmoney_get_json(url, params, f"获取个股信息 {normalized}", timeout=10)
    data = data_json.get("data") or {}
    code_name_map = {
        "f57": "股票代码",
        "f58": "股票简称",
        "f84": "总股本",
        "f85": "流通股",
        "f127": "行业",
        "f116": "总市值",
        "f117": "流通市值",
        "f189": "上市时间",
        "f43": "最新",
    }
    rows = [
        {"item": item, "value": data.get(field)}
        for field, item in code_name_map.items()
        if field in data
    ]
    return pd.DataFrame(rows, columns=["item", "value"])


def fetch_stock_hist_em(
    symbol: str,
    start_date: str,
    end_date: str,
    adjust: str = "qfq",
    period: str = "daily",
) -> pd.DataFrame:
    """从东方财富获取历史 K 线数据。"""
    normalized = normalize_symbol(symbol)
    adjust_dict = {"qfq": "1", "hfq": "2", "": "0"}
    period_dict = {"daily": "101", "weekly": "102", "monthly": "103"}
    url = "http://push2his.eastmoney.com/api/qt/stock/kline/get"
    params = {
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
        "ut": "7eea3edcaed734bea9cbfc24409ed989",
        "klt": period_dict[period],
        "fqt": adjust_dict[adjust],
        "secid": f"{get_market_code(normalized)}.{normalized}",
        "beg": start_date,
        "end": end_date,
    }
    data_json = eastmoney_get_json(url, params, f"获取前复权日 K {normalized}", timeout=10)
    data = data_json.get("data") or {}
    klines = data.get("klines") or []
    if not klines:
        return pd.DataFrame()

    df = pd.DataFrame([item.split(",") for item in klines])
    df["股票代码"] = normalized
    df.columns = [
        "日期",
        "开盘",
        "收盘",
        "最高",
        "最低",
        "成交量",
        "成交额",
        "振幅",
        "涨跌幅",
        "涨跌额",
        "换手率",
        "股票代码",
    ]
    return df


def get_tencent_symbol(symbol: str) -> str:
    """把 6 位 A 股代码转换成腾讯行情接口使用的市场前缀代码。"""
    normalized = normalize_symbol(symbol)
    if normalized.startswith("6"):
        return f"sh{normalized}"
    if normalized.startswith(("4", "8", "9")):
        return f"bj{normalized}"
    return f"sz{normalized}"


def fetch_stock_hist_tencent(symbol: str, count: int = 45) -> pd.DataFrame:
    """从腾讯行情获取前复权日 K，作为更稳定的默认 K 线来源。"""
    tencent_symbol = get_tencent_symbol(symbol)
    cache_path = today_cache_path(f"kline_{normalize_symbol(symbol)}_{count}")
    urls = [
        (
            "腾讯前复权 K 线",
            "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
            f"?param={tencent_symbol},day,,,{count},qfq",
        ),
        (
            "腾讯代理前复权 K 线",
            "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get"
            f"?param={tencent_symbol},day,,,{count},qfq",
        ),
        (
            "腾讯普通 K 线",
            "https://web.ifzq.gtimg.cn/appstock/app/kline/kline"
            f"?param={tencent_symbol},day,,,{count}",
        ),
        (
            "腾讯代理普通 K 线",
            "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/kline/kline"
            f"?param={tencent_symbol},day,,,{count}",
        ),
    ]

    errors: list[str] = []
    klines: list[list[Any]] = []
    for description, url in urls:
        try:
            data_json = generic_get_json(
                url,
                f"{description} {symbol}",
                timeout=10,
                max_retries=1,
            )
            stock_data = (data_json.get("data") or {}).get(tencent_symbol) or {}
            klines = stock_data.get("qfqday") or stock_data.get("day") or []
            if klines:
                logging.debug("%s 使用数据源: %s", symbol, description)
                break
            errors.append(f"{description}: 返回空 K 线")
        except Exception as exc:
            errors.append(f"{description}: {exc}")

    if not klines:
        cached_df = load_cached_df(cache_path)
        if cached_df is not None:
            return cached_df
        raise RuntimeError(f"所有腾讯 K 线接口均失败 {symbol}: " + " | ".join(errors))

    df = pd.DataFrame(klines)
    df = df.iloc[:, :6]
    df.columns = ["日期", "开盘", "收盘", "最高", "最低", "成交量"]
    df["股票代码"] = normalize_symbol(symbol)
    df["成交额"] = np.nan
    df["振幅"] = np.nan
    df["涨跌幅"] = np.nan
    df["涨跌额"] = np.nan
    df["换手率"] = np.nan
    result_df = df[
        [
            "日期",
            "股票代码",
            "开盘",
            "收盘",
            "最高",
            "最低",
            "成交量",
            "成交额",
            "振幅",
            "涨跌幅",
            "涨跌额",
            "换手率",
        ]
    ]
    save_cached_df(result_df, cache_path)
    return result_df


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
    required = {"代码", "名称", "总市值", "最新价", "上市时间", "板块", "概念"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"stock_zh_a_spot_em 缺少字段: {missing}")

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

    if sector_keyword:
        keyword = str(sector_keyword).strip()
        searchable = (
            df["名称"].astype(str)
            + "|"
            + df["板块"].astype(str)
            + "|"
            + df["概念"].astype(str)
        )
        df = df[searchable.str.contains(keyword, na=False)]

    return df[["代码", "名称", "总市值", "上市时间", "板块", "概念"]].reset_index(drop=True)


def get_listing_date(symbol: str) -> pd.Timestamp | None:
    """从东方财富个股信息中获取上市日期。"""
    info = get_stock_info(symbol)
    return extract_listing_date(info)


def parse_listing_date(raw: Any) -> pd.Timestamp | None:
    """解析东方财富返回的上市日期，例如 20200101。"""
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
    """按股票代码获取一只股票的东方财富基础信息。"""
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

    try:
        df = fetch_stock_hist_tencent(symbol=symbol, count=max(45, MIN_K_DAYS + 5))
    except Exception as exc:
        logging.warning("腾讯 K 线失败，改用东方财富 K 线 %s: %s", symbol, exc)
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
    try:
        return normalize_k_df(fetch_stock_hist_tencent(symbol=symbol, count=count))
    except Exception as exc:
        logging.warning("腾讯一年 K 线失败，改用东方财富 K 线 %s: %s", symbol, exc)

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


def log_filter_stats(stats: dict[str, int]) -> None:
    """输出本次运行每层筛选的通过和过滤数量。"""
    logging.info("========== 筛选统计 ==========")
    logging.info("基础过滤后待扫描: %s", stats["基础过滤后待扫描"])
    logging.info("上市时间不足/缺失: %s", stats["上市时间不足/缺失"])
    logging.info("上市时间通过: %s", stats["上市时间通过"])
    logging.info("一年趋势不通过: %s", stats["一年趋势不通过"])
    logging.info("一年趋势通过: %s", stats["一年趋势通过"])
    logging.info("K线数据不足: %s", stats["K线数据不足"])
    logging.info("K线数据通过: %s", stats["K线数据通过"])
    logging.info("成交量不通过: %s", stats["成交量不通过"])
    logging.info("成交量通过: %s", stats["成交量通过"])
    logging.info("碗型不通过: %s", stats["碗型不通过"])
    logging.info("碗型通过: %s", stats["碗型通过"])
    logging.info("接口异常/其他异常: %s", stats["接口异常/其他异常"])
    logging.info("最终命中: %s", stats["最终命中"])
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
                    sector,
                    k_df,
                    metrics,
                    enable_bowl_filter,
                    sector_keyword,
                )
            )
            stats["最终命中"] += 1
            logging.info("命中: %s %s", symbol, name)

        except Exception as exc:
            stats["接口异常/其他异常"] += 1
            logging.warning("跳过 %s %s: %s", symbol, name, exc)

        finally:
            if i % 50 == 0:
                logging.info("进度: %s/%s", i + 1, len(universe))
            time.sleep(sleep_seconds)

    log_filter_stats(stats)
    return pd.DataFrame(rows)


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
    """清理临时 K 线缓存，仅保留当天股票池用于网络失败时降级。"""
    if not CACHE_DIR.exists():
        return

    stock_spot_cache_name = f"stock_spot_{datetime.now():%Y%m%d}.csv"
    removed_count = 0
    for path in CACHE_DIR.iterdir():
        if path.is_file() and path.name != stock_spot_cache_name:
            path.unlink()
            removed_count += 1

    try:
        CACHE_DIR.rmdir()
    except OSError:
        pass

    logging.info(
        "已清理缓存文件 %s 个，保留当日股票池缓存 %s",
        removed_count,
        stock_spot_cache_name,
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
        help="使用当前终端的 HTTP/HTTPS 代理环境变量；默认会清除代理以避免东方财富接口连接失败",
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
    use_proxy: bool = False,
) -> pd.DataFrame:
    """按指定配置执行筛选、导出 Excel，并返回结果表。"""
    configure_network(use_proxy=use_proxy)
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
            "这通常是东方财富接口网络不稳定或本机代理导致。可稍后重试；如必须走代理，请使用 --use-proxy。"
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
        use_proxy=args.use_proxy,
    )


if __name__ == "__main__":
    main()
