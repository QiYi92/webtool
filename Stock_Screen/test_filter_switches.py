import unittest
from unittest.mock import patch

import pandas as pd

import screen_bowl_shape as screen


class FilterSwitchTests(unittest.TestCase):
    def test_disabled_stage_filters_allow_incomplete_stock_to_pass(self) -> None:
        universe = pd.DataFrame(
            [
                {
                    "代码": "000001",
                    "名称": "测试股票",
                    "总市值": 20_000_000_000,
                    "上市时间": None,
                    "板块": "测试板块",
                    "概念": "",
                }
            ]
        )
        empty_k = pd.DataFrame(
            columns=["日期", "开盘", "收盘", "最高", "最低", "成交量"]
        )
        config = screen.deep_merge_config(
            screen.DEFAULT_SCREEN_CONFIG,
            {
                "basic": {
                    "enable_listing_filter": False,
                    "enable_trend_filter": False,
                    "enable_k_data_filter": False,
                    "enable_volume_filter": False,
                    "enable_bowl_filter": False,
                }
            },
        )

        with (
            patch.object(screen, "get_stock_universe", return_value=universe),
            patch.object(screen, "fetch_recent_k", return_value=empty_k),
            patch.object(screen.time, "sleep"),
        ):
            result = screen.screen_stocks(config=config, sleep_seconds=0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["股票代码"], "000001")
        self.assertEqual(result.iloc[0]["上市时间"], "—")

    def test_enabled_listing_filter_rejects_missing_listing_date(self) -> None:
        universe = pd.DataFrame(
            [
                {
                    "代码": "000001",
                    "名称": "测试股票",
                    "总市值": 20_000_000_000,
                    "上市时间": None,
                    "板块": "测试板块",
                    "概念": "",
                }
            ]
        )

        with (
            patch.object(screen, "get_stock_universe", return_value=universe),
            patch.object(screen, "fetch_recent_k") as fetch_recent_k,
            patch.object(screen.time, "sleep"),
        ):
            result = screen.screen_stocks(
                config=screen.DEFAULT_SCREEN_CONFIG,
                sleep_seconds=0,
            )

        self.assertTrue(result.empty)
        fetch_recent_k.assert_not_called()


if __name__ == "__main__":
    unittest.main()
