"""低位平台模型：只使用截止日及以前的完整前复权日线。"""
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


def completed_daily_bars(df: pd.DataFrame, now: datetime | None = None) -> pd.DataFrame:
    """保留已收盘日线；保留异常值供模型明确拒绝，避免静默补齐窗口。"""
    if df.empty:
        return df.copy()
    df = df.copy()
    df["日期"] = pd.to_datetime(df["日期"], errors="coerce")
    for column in ("开盘", "最高", "最低", "收盘", "成交量"):
        df[column] = pd.to_numeric(df[column], errors="coerce")
    now = now or datetime.now(ZoneInfo("Asia/Shanghai"))
    dates = pd.to_datetime(df["日期"], errors="coerce")
    today = pd.Timestamp(now.date())
    return df.loc[dates.isna() | (dates < today) | ((dates == today) & (now.hour >= 15))].copy()


def evaluate_bottom(
    df: pd.DataFrame, config: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    """判断低位平台并分类；输入必须已按筛选截止时间裁剪。"""
    p = config["bottom"]
    n, w, s = p["year_days"], p["platform_days"], p["signal_days"]
    metrics: dict[str, Any] = {}

    def reject(reason: str) -> tuple[bool, dict[str, Any]]:
        return False, {**metrics, "未通过原因": reason}
    if not (isinstance(n, int) and isinstance(w, int) and isinstance(s, int)
            and w >= 20 and w % 2 == 0 and s >= 1 and n >= max(w + s, 20 + s)):
        raise ValueError("底部模型窗口配置无效：平台须为至少20日的偶数，年内窗口须覆盖平台和信号期")
    if len(df) < n:
        return reject("日线数据不足")
    data = df.iloc[-n:].copy()
    fields = ["开盘", "最高", "最低", "收盘", "成交量"]
    if data["日期"].isna().any() or data["日期"].duplicated().any() or not data["日期"].is_monotonic_increasing:
        return reject("日期缺失、重复或未排序")
    values = data[fields].apply(pd.to_numeric, errors="coerce")
    if not np.isfinite(values.to_numpy()).all() or (values[fields[:4]] <= 0).any().any():
        return reject("价格或成交量数据无效")
    if ((values["最高"] < values[["开盘", "收盘", "最低"]].max(axis=1)) | (values["最低"] > values[["开盘", "收盘"]].min(axis=1))).any():
        return reject("价格区间无效")
    if (values["成交量"].iloc[-(w+s):] <= 0).any():
        return reject("平台或信号期存在零成交量")
    platform = values.iloc[-(w+s):-s]
    signal = values.iloc[-s:]
    close = values["收盘"]
    latest = close.iloc[-1]
    high, low = values["最高"].max(), values["最低"].min()
    if high <= low:
        return reject("年内价格区间为零")
    floor = platform["收盘"].min()
    slope = np.polyfit(np.arange(w), platform["收盘"], 1)[0] * (w-1) / platform["收盘"].mean()
    position = (latest-low)/(high-low)
    drawdown = 1-latest/high
    amplitude = platform["最高"].max()/platform["最低"].min()-1
    close_amplitude = platform["收盘"].max()/floor-1
    support = platform["收盘"].iloc[w//2:].min()/platform["收盘"].iloc[:w//2].min()
    volume_ratio = signal["成交量"].mean()/platform["成交量"].iloc[-20:].mean()
    gain = latest/close.iloc[-s-1]-1
    metrics.update({"年内位置": float(position), "年内回撤": float(drawdown), "平台振幅": float(amplitude),
                    "平台收盘振幅": float(close_amplitude), "平台斜率": float(slope), "平台下沿比": float(support),
                    "近期量比": float(volume_ratio), "近期涨幅": float(gain), "筛选日期": str(pd.Timestamp(data["日期"].iloc[-1]).date())})
    if not all(np.isfinite(value) for key, value in metrics.items() if key != "筛选日期"):
        return reject("指标无法计算")
    checks = [(position <= p["max_year_position"], "年内位置过高"), (drawdown >= p["min_drawdown"], "回撤不足"),
              (amplitude <= p["max_platform_amplitude"], "平台振幅过大"), (close_amplitude <= p["max_close_amplitude"], "平台收盘振幅过大"),
              (abs(slope) <= p["max_abs_slope"], "平台趋势不平缓"), (support >= p["min_support_ratio"], "平台下沿下移"),
              (signal["收盘"].min()/floor >= p["min_signal_support_ratio"], "近期破位"), (latest/floor <= p["max_bottom_ratio"], "已远离底部")]
    failures = [reason for passed, reason in checks if not passed]
    if failures:
        return reject("、".join(failures))
    ma10, ma20 = close.iloc[-10:].mean(), close.iloc[-20:].mean()
    strong = (latest > platform["收盘"].quantile(p["strength_quantile"]) and latest > ma10 >= ma20
              and ma10 > close.iloc[-10-s:-s].mean() and volume_ratio >= p["strength_volume_ratio"]
              and p["strength_min_gain"] <= gain <= p["strength_max_gain"])
    return True, {**metrics, "碗型阶段": "出现转强" if strong else "横盘未突破"}
