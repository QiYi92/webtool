from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import screen_bowl_shape as screener


def build_page(records: list[dict], total: int) -> dict:
    return {"data": {"diff": records, "total": total}}


class StockListFetchTests(unittest.TestCase):
    def test_page_failure_switches_to_backup_node(self) -> None:
        urls = ("https://primary.example", "https://backup.example")

        def fake_get(url, params, description, timeout, max_retries):
            del params, description, timeout, max_retries
            if url == urls[0]:
                raise ConnectionError("primary disconnected")
            return build_page([{"f12": "000001"}], total=1)

        with patch.object(screener, "eastmoney_get_json", side_effect=fake_get):
            page_json, active_url = screener.fetch_stock_list_page(
                {"pn": "1"},
                page=1,
                preferred_url=urls[0],
                urls=urls,
                node_rounds=1,
            )

        self.assertEqual(active_url, urls[1])
        self.assertEqual(page_json["data"]["diff"][0]["f12"], "000001")

    def test_paginated_fetch_deduplicates_records_after_node_switch(self) -> None:
        urls = ("https://primary.example", "https://backup.example")

        def fake_page(params, page, preferred_url=None, urls=urls, node_rounds=2):
            del params, preferred_url, urls, node_rounds
            if page == 1:
                return (
                    build_page(
                        [
                            {
                                "f2": 10,
                                "f12": "000001",
                                "f14": "平安银行",
                                "f20": 100,
                                "f26": "19910403",
                                "f100": "银行",
                                "f103": "金融",
                            }
                        ],
                        total=101,
                    ),
                    "https://primary.example",
                )
            return (
                build_page(
                    [
                        {
                            "f2": 11,
                            "f12": "000001",
                            "f14": "平安银行",
                            "f20": 101,
                            "f26": "19910403",
                            "f100": "银行",
                            "f103": "金融",
                        },
                        {
                            "f2": 20,
                            "f12": "600000",
                            "f14": "浦发银行",
                            "f20": 200,
                            "f26": "19991110",
                            "f100": "银行",
                            "f103": "金融",
                        },
                    ],
                    total=101,
                ),
                "https://backup.example",
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.object(screener, "CACHE_DIR", Path(temp_dir)),
                patch.object(screener, "fetch_stock_list_page", side_effect=fake_page),
                patch.object(screener.time, "sleep"),
            ):
                result = screener.fetch_stock_spot_em()

        self.assertEqual(result["代码"].tolist(), ["000001", "600000"])
        self.assertEqual(result.iloc[0]["最新价"], 11)

    def test_fetch_uses_current_day_cache_after_all_nodes_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir)
            with patch.object(screener, "CACHE_DIR", cache_dir):
                cache_path = screener.today_cache_path("stock_spot")
                pd.DataFrame(
                    [
                        {
                            "代码": "000001",
                            "名称": "平安银行",
                            "最新价": 10,
                            "总市值": 100,
                            "上市时间": "19910403",
                            "板块": "银行",
                            "概念": "金融",
                        }
                    ]
                ).to_csv(cache_path, index=False, encoding="utf-8-sig")
                with patch.object(
                    screener,
                    "fetch_stock_list_page",
                    side_effect=RuntimeError("all nodes failed"),
                ):
                    result = screener.fetch_stock_spot_em()

        self.assertEqual(result.iloc[0]["代码"], "000001")

    def test_cleanup_preserves_only_current_stock_list_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir)
            current_cache = cache_dir / f"stock_spot_{screener.datetime.now():%Y%m%d}.csv"
            old_cache = cache_dir / "stock_spot_20000101.csv"
            kline_cache = cache_dir / "kline_000001.csv"
            current_cache.write_text("current", encoding="utf-8")
            old_cache.write_text("old", encoding="utf-8")
            kline_cache.write_text("kline", encoding="utf-8")

            with patch.object(screener, "CACHE_DIR", cache_dir):
                screener.cleanup_cache_dir()

            self.assertTrue(current_cache.exists())
            self.assertFalse(old_cache.exists())
            self.assertFalse(kline_cache.exists())


if __name__ == "__main__":
    unittest.main()
