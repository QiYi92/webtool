"""横盘未突破的附加门槛；不改变底部模型原来的转强判定。"""
from typing import Any

import numpy as np
import pandas as pd

STAGES = ("长期数据", "五年低位", "平台稳定", "交易热度", "流动性")


def at_most(value: float, limit: float) -> bool:
    # 仅消除浮点运算尾差，不改变业务阈值。
    return value <= limit + 1e-12


def at_least(value: float, limit: float) -> bool:
    return value >= limit - 1e-12


def evaluate_sideways(
    bars: pd.DataFrame,
    listing_date: pd.Timestamp | None,
    as_of: str,
    config: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    p = config["sideways"]
    end = pd.Timestamp(as_of).normalize()
    start = end - pd.DateOffset(years=p["history_years"])
    passed_stages: list[str] = []
    metrics: dict[str, Any] = {"规则版本": p["version"], "筛选日期": str(end.date())}

    def reject(stage: str, reason: str, unavailable: bool = False):
        return False, {**metrics, "未通过环节": stage, "未通过原因": reason, "未验证": unavailable, "通过环节": list(passed_stages)}

    if listing_date is None or pd.isna(listing_date):
        return reject("长期数据", "上市日期缺失", True)
    if pd.Timestamp(listing_date) > start:
        return reject("长期数据", "上市不足五年")
    required = ["日期", "开盘", "收盘", "最高", "最低", "成交量", "换手率", "成交额"]
    if not set(required).issubset(bars.columns):
        return reject("长期数据", "长期行情字段缺失", True)
    data = bars[required].copy()
    data["日期"] = pd.to_datetime(data["日期"], errors="coerce")
    if data["日期"].isna().any() or data["日期"].duplicated().any():
        return reject("长期数据", "日期缺失或重复", True)
    data = data.loc[data["日期"].between(start, end)].sort_values("日期").reset_index(drop=True)
    if (len(data) < p["min_history_bars"] or
            data["日期"].iloc[0] > start + pd.Timedelta(days=p["start_tolerance_days"]) or
            data["日期"].iloc[-1] != end):
        return reject("长期数据", "五年行情覆盖不足或末日缺失", True)
    data[required[1:]] = data[required[1:]].apply(pd.to_numeric, errors="coerce")
    prices = data[["开盘", "收盘", "最高", "最低"]]
    if (not np.isfinite(prices.to_numpy()).all() or (prices <= 0).any().any() or
            (data["最高"] < prices.max(axis=1)).any() or (data["最低"] > prices.min(axis=1)).any()):
        return reject("长期数据", "价格缺失、无效或复权异常", True)
    recent = data.iloc[-120:]
    if not np.isfinite(recent[["成交量", "换手率", "成交额"]].to_numpy()).all():
        return reject("长期数据", "近期量能字段缺失或无效", True)

    if (recent[["成交量", "换手率", "成交额"]] <= 0).any().any():
        return reject("长期数据", "最近120日存在零值或负值量能")
    passed_stages.append("长期数据")
    close = data["收盘"]
    latest = float(close.iloc[-1])
    w, s = config["bottom"]["platform_days"], config["bottom"]["signal_days"]
    platform, signal = data.iloc[-w-s:-s], data.iloc[-s:]
    q10, q20, median = close.quantile([.1, .2, .5], interpolation="linear")
    platform_median = float(platform["收盘"].median())
    rank = float((close <= latest).mean())
    metrics.update({
        "五年价格分位": rank,
        "平台价格分位": float((close <= platform_median).mean()),
        "平台中位价相对五年20分位": platform_median / q20,
        "相对五年10分位": latest / q10,
        "相对长期中位价": latest / median,
        "五年行情条数": len(data),
    })
    if not (at_most(rank, p["max_price_percentile"]) and at_most(platform_median, q20) and
            at_most(latest / q10, p["max_q10_ratio"]) and at_most(latest / median, p["max_median_ratio"])):
        return reject("五年低位", "五年价格或平台位置偏高")

    passed_stages.append("五年低位")
    floor, ceiling = float(platform["收盘"].min()), float(platform["收盘"].max())
    amplitude = float(platform["最高"].max() / platform["最低"].min() - 1)
    close_amplitude = ceiling / floor - 1
    slope = float(np.polyfit(np.arange(w), platform["收盘"], 1)[0] * (w - 1) / platform["收盘"].mean())
    support = float(platform["收盘"].iloc[w//2:].min() / platform["收盘"].iloc[:w//2].min())
    signal_support = float(signal["收盘"].min() / floor)
    metrics.update({"平台振幅": amplitude, "平台收盘振幅": close_amplitude, "平台斜率": slope,
                    "平台下沿比": support, "近期下沿比": signal_support,
                    "相对平台下沿": latest / floor, "相对平台上沿": latest / ceiling})
    if not (at_most(amplitude, p["max_platform_amplitude"]) and at_most(close_amplitude, p["max_close_amplitude"]) and
            at_most(abs(slope), p["max_abs_slope"]) and at_least(support, p["min_support_ratio"]) and
            at_least(signal_support, p["min_signal_support_ratio"]) and at_most(latest / floor, p["max_bottom_ratio"]) and
            at_most(latest / ceiling, p["max_ceiling_ratio"])):
        return reject("平台稳定", "平台振幅、趋势、支撑或反弹幅度不符合")

    passed_stages.append("平台稳定")
    turnover = recent["换手率"]  # 数据接入层已从百分数换算为比例。
    mean20, previous100 = float(turnover.iloc[-20:].mean()), float(turnover.iloc[:-20].mean())
    median20 = float(turnover.iloc[-20:].median())
    amount20 = float(recent["成交额"].iloc[-20:].median())
    ratio, expansion = mean20 / previous100, float(turnover.iloc[-5:].mean()) / mean20
    metrics.update({"换手收缩比": ratio, "20日换手率中位数": median20,
                    "20日最大换手率": float(turnover.iloc[-20:].max()), "5日换手扩张比": expansion,
                    "20日成交额中位数": amount20})
    if not (at_most(ratio, p["max_turnover_ratio"]) and
            at_least(median20, p["min_turnover_median"]) and at_most(median20, p["max_turnover_median"]) and
            at_most(turnover.iloc[-20:].max(), p["max_daily_turnover"]) and at_most(expansion, p["max_turnover_expansion"])):
        return reject("交易热度", "换手水平或缩量程度不符合")
    passed_stages.append("交易热度")
    if not at_least(amount20, p["min_amount_median"]):
        return reject("流动性", "20日成交额中位数不足")
    return True, {**metrics, "碗型阶段": "横盘未突破"}
