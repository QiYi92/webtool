from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import screen_bowl_shape as screener
from akshare_data import AKShareConnectionError, AKShareDataError, _invoke_with_deadline, fetch_stock_history, fetch_stock_info, fetch_stock_spot


class AKShareAdapterTests(unittest.TestCase):
    def test_upstream_call_without_its_own_timeout_is_bounded(self):
        from threading import Event

        with self.assertRaisesRegex(AKShareConnectionError, "无响应"):
            _invoke_with_deadline(lambda: Event().wait(1), {}, 0.01)

    def test_market_sources_bypass_unstable_local_proxy_by_default(self):
        with patch.dict(os.environ, {"HTTPS_PROXY": "http://127.0.0.1:7897", "NO_PROXY": "localhost"}, clear=True):
            screener.configure_network()
            self.assertEqual(os.environ["HTTPS_PROXY"], "http://127.0.0.1:7897")
            self.assertIn(".gtimg.cn", os.environ["NO_PROXY"])
            screener.configure_network()
            self.assertEqual(os.environ["NO_PROXY"].count(".gtimg.cn"), 1)

    def test_spot_maps_live_fields_and_requires_current_quote_data(self):
        raw = pd.DataFrame([{"code": "sh600519", "name": "贵州茅台", "zxj": "1500", "zsz": "18000"}])
        sh = pd.DataFrame([{"证券代码": "600519", "上市日期": "2001-08-27"}])
        sz = pd.DataFrame([{"A股代码": "000001", "A股上市日期": "1991-04-03", "所属行业": "金融业"}])
        bj = pd.DataFrame([{"证券代码": "920000", "上市日期": "2020-12-23", "所属行业": "制造业"}])
        with patch("akshare_data._call", side_effect=[raw, sh, sz, bj]) as call:
            result = fetch_stock_spot()
        self.assertEqual(result.iloc[0]["代码"], "600519")
        self.assertEqual(result.iloc[0]["总市值"], 1_800_000_000_000)
        self.assertEqual(result.iloc[0]["上市时间"], "2001-08-27")
        self.assertEqual(call.call_args_list[0].args[0], "stock_zh_a_spot_tx")

    def test_spot_rejects_missing_fields_and_empty_quotes(self):
        with patch("akshare_data._call", return_value=pd.DataFrame([{"code": "sh600519"}])):
            with self.assertRaisesRegex(AKShareDataError, "缺少字段"):
                fetch_stock_spot()
        valid = pd.DataFrame([{"code": "sh600519", "name": "贵州茅台", "zxj": 1500, "zsz": 10}])
        with patch("akshare_data._call", return_value=valid.iloc[0:0]):
            with self.assertRaisesRegex(AKShareDataError, "空数据"):
                fetch_stock_spot()

    def test_profile_schema_is_checked(self):
        with patch("akshare_data._call", return_value=pd.DataFrame([{"bad": "field"}])):
            with self.assertRaisesRegex(AKShareDataError, "资料字段无效"):
                fetch_stock_info("600519")
        fetch_stock_info.cache_clear()

    def test_history_checks_required_fields_and_normalizes_dates(self):
        raw = pd.DataFrame([{
            "date": "2026-09-23", "open": "10", "close": "11", "high": "12", "low": "9",
            "volume": "10000", "amount": "1000", "turnover": "0.005",
        }])
        with patch("akshare_data._call", return_value=raw) as call:
            result = fetch_stock_history("1", "20260901", "20260930")
        self.assertEqual(result.iloc[0]["股票代码"], "000001")
        self.assertEqual(result.iloc[0]["收盘"], 11)
        self.assertEqual(result.iloc[0]["成交量"], 100)
        self.assertEqual(result.iloc[0]["换手率"], 0.5)
        self.assertEqual(result.iloc[0]["日期"], pd.Timestamp("2026-09-23"))
        self.assertEqual(call.call_args.args[0], "stock_zh_a_hist_tx")
        self.assertEqual(call.call_args.kwargs["symbol"], "sz000001")

    def test_beijing_history_uses_akshare_sina_with_same_units(self):
        raw = pd.DataFrame([{
            "date": "2026-09-23", "open": 10, "close": 11, "high": 12, "low": 9,
            "volume": 10000, "amount": 100000, "turnover": 0.005,
        }])
        with patch("akshare_data._call", return_value=raw) as call:
            result = fetch_stock_history("920185", "20260901", "20260930")
        self.assertEqual(call.call_args.args[0], "stock_zh_a_daily")
        self.assertEqual(call.call_args.kwargs["symbol"], "bj920185")
        self.assertEqual(result.iloc[0]["换手率"], 0.5)

    def test_history_rejects_missing_fields_and_empty_data(self):
        raw = pd.DataFrame([{"date": "2026-09-23", "close": 11}])
        with patch("akshare_data._call", return_value=raw):
            with self.assertRaisesRegex(AKShareDataError, "缺少字段"):
                fetch_stock_history("600519", "20260901", "20260930")

    def test_spot_connection_error_stops_without_using_cache_or_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cache = Path(temp_dir) / "stock_spot_20260924.csv"
            old_cache.write_text("not used", encoding="utf-8")
            with patch.object(screener, "CACHE_DIR", Path(temp_dir)), \
                 patch.object(screener, "fetch_stock_spot", side_effect=RuntimeError("offline")):
                with self.assertRaisesRegex(screener.MarketDataConnectionError, "任务已停止"):
                    screener.fetch_stock_spot_em()

    def test_cache_cleanup_keeps_only_today_audit_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir)
            current = cache_dir / f"stock_spot_{screener.datetime.now():%Y%m%d}.csv"
            old = cache_dir / "stock_spot_20000101.csv"
            kline = cache_dir / "kline_000001.csv"
            for path in (current, old, kline):
                path.write_text("cache", encoding="utf-8")
            with patch.object(screener, "CACHE_DIR", cache_dir):
                screener.cleanup_cache_dir()
            self.assertTrue(current.exists())
            self.assertFalse(old.exists())
            self.assertFalse(kline.exists())


if __name__ == "__main__":
    unittest.main()
