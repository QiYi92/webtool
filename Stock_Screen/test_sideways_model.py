import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

import screen_bowl_shape as screen
from bottom_model import evaluate_bottom
from sideways_data import HistoryDataError, fetch_sideways_history
from sideways_model import evaluate_sideways
from test_bottom_model import sample

AS_OF = "2026-09-07"
LISTED = pd.Timestamp("2010-01-01")


def history():
    dates = pd.bdate_range("2021-09-07", AS_OF)
    short = sample()
    close = np.r_[np.linspace(12, 10, len(dates)-250), short["收盘"].to_numpy()]
    bars = pd.DataFrame({"日期": dates, "开盘": close, "收盘": close,
                         "最高": close+.05, "最低": close-.05, "成交量": 100.,
                         "成交额": 5e7, "换手率": .01})
    bars.loc[bars.index[-20:], "换手率"] = .005
    return bars


class SidewaysTests(unittest.TestCase):
    def setUp(self):
        self.config = screen.load_screen_config(str(Path(__file__).parent / "configs/default_bottom.json"))

    def evaluate(self, bars, **kwargs):
        return evaluate_sideways(bars, kwargs.get("listed", LISTED), AS_OF, kwargs.get("config", self.config))

    def test_valid_and_subset(self):
        bars = history()
        self.assertTrue(evaluate_bottom(bars, self.config)[0])
        passed, metrics = self.evaluate(bars)
        self.assertTrue(passed, metrics)
        self.assertEqual(metrics["规则版本"], "sideways_v2")
        self.assertAlmostEqual(metrics["换手收缩比"], .5)
        self.assertAlmostEqual(metrics["20日换手率中位数"], .005)

    def test_year_low_and_spike_do_not_imply_five_year_low(self):
        for spike in (False, True):
            bars = history()
            idx = bars.index[:-250]
            for field, value in [("开盘",5.),("收盘",5.),("最高",5.05),("最低",4.95)]:
                bars.loc[idx,field] = value
            if spike:
                bars.loc[100,["开盘","收盘","最高","最低"]] = [100,100,101,99]
            self.assertTrue(evaluate_bottom(bars, self.config)[0])
            passed, metrics = self.evaluate(bars)
            self.assertFalse(passed)
            self.assertEqual(metrics["未通过环节"], "五年低位")

    def test_each_rejection_stage_and_missing_data(self):
        cases = []
        short=history().iloc[300:]; cases.append((short,"长期数据",True))
        missing=history().drop(columns="换手率"); cases.append((missing,"长期数据",True))
        missing_value=history(); missing_value.loc[missing_value.index[-1],"成交额"]=np.nan
        cases.append((missing_value,"长期数据",True))
        zero=history(); zero.loc[zero.index[-90],"成交量"]=0; cases.append((zero,"长期数据",False))
        invalid=history(); invalid.loc[invalid.index[10],"收盘"]=-1; cases.append((invalid,"长期数据",True))
        unstable=history(); unstable.loc[unstable.index[-30],"最高"]=7.2; cases.append((unstable,"平台稳定",False))
        broken=history(); broken.loc[broken.index[-1],["开盘","收盘","最高","最低"]]=[6.1,6.1,6.15,6.05]
        cases.append((broken,"平台稳定",False))
        hot=history(); hot.loc[hot.index[-20:],"换手率"] = .02; cases.append((hot,"交易热度",False))
        illiquid=history(); illiquid.loc[illiquid.index[-20:],"成交额"] = 1e7; cases.append((illiquid,"流动性",False))
        for data, stage, unavailable in cases:
            with self.subTest(stage=stage, unavailable=unavailable):
                passed, metrics = self.evaluate(data)
                self.assertFalse(passed)
                self.assertEqual(metrics["未通过环节"],stage)
                self.assertEqual(metrics["未验证"],unavailable)
        self.assertEqual(self.evaluate(history(),listed=pd.Timestamp("2022-01-01"))[1]["未通过原因"],"上市不足五年")

    def test_boundaries(self):
        bars = history()
        _, metrics = self.evaluate(bars)
        boundaries = [("max_price_percentile","五年价格分位",False),
                      ("max_q10_ratio","相对五年10分位",False),
                      ("max_median_ratio","相对长期中位价",False),
                      ("max_platform_amplitude","平台振幅",False),
                      ("max_close_amplitude","平台收盘振幅",False),
                      ("max_abs_slope","平台斜率",False),
                      ("min_support_ratio","平台下沿比",True),
                      ("min_signal_support_ratio","近期下沿比",True),
                      ("max_bottom_ratio","相对平台下沿",False),
                      ("max_ceiling_ratio","相对平台上沿",False),
                      ("max_turnover_ratio","换手收缩比",False),
                      ("max_turnover_median","20日换手率中位数",False),
                      ("min_turnover_median","20日换手率中位数",True),
                      ("max_daily_turnover","20日最大换手率",False),
                      ("max_turnover_expansion","5日换手扩张比",False),
                      ("min_amount_median","20日成交额中位数",True)]
        for parameter, metric, minimum in boundaries:
            with self.subTest(parameter=parameter):
                config=copy.deepcopy(self.config)
                config["sideways"][parameter]=abs(metrics[metric]) if parameter=="max_abs_slope" else metrics[metric]
                self.assertTrue(self.evaluate(bars,config=config)[0])
                config["sideways"][parameter] += 1e-8 if minimum else -1e-8
                self.assertFalse(self.evaluate(bars,config=config)[0])

    def test_literal_turnover_boundary(self):
        bars = history()
        bars.loc[bars.index[-20:], "换手率"] = .007
        self.assertTrue(self.evaluate(bars)[0])
        bars.loc[bars.index[-20:], "换手率"] = .007001
        self.assertFalse(self.evaluate(bars)[0])

    def test_successful_screen_exports_new_metrics(self):
        from openpyxl import load_workbook
        universe = pd.DataFrame([{"代码": "002531", "名称": "测试", "总市值": 20e9,
                                  "上市时间": 20100101, "板块": "测试", "概念": ""}])
        with patch.object(screen, "get_stock_universe", return_value=universe), patch.object(screen, "fetch_bottom_k", return_value=sample()), patch.object(screen, "fetch_sideways_history", return_value=history()), self.assertLogs(level="INFO") as logs:
            result = screen.screen_stocks(config=self.config, sleep_seconds=0)
        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["规则版本"], "sideways_v2")
        self.assertIn("流动性通过: 1", [r.getMessage() for r in logs.records])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.xlsx"
            screen.export_sector_summary_excel(result, path)
            workbook = load_workbook(path, read_only=True)
            headers = [cell.value for cell in workbook["模型指标"][1]]
            for column in ("五年价格分位", "平台价格分位", "相对长期中位价", "换手收缩比", "20日换手率中位数", "20日成交额中位数", "规则版本"):
                self.assertIn(column, headers)
            workbook.close()

    def test_cache_units_and_future_cutoff(self):
        data=history(); data["换手率"]*=100
        future=data.iloc[[-1]].copy(); future["日期"]=pd.Timestamp("2026-09-08")
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(screen,"fetch_stock_hist_em",return_value=pd.concat([data,future])) as fetch:
                result=fetch_sideways_history("002531",AS_OF,self.config,fetch,Path(directory))
                again=fetch_sideways_history("002531",AS_OF,self.config,fetch,Path(directory))
                self.assertEqual(fetch.call_count,1)
            self.assertEqual(result["日期"].max(),pd.Timestamp(AS_OF))
            self.assertAlmostEqual(result["换手率"].iloc[-1],.005)
            pd.testing.assert_frame_equal(result,again,check_dtype=False)

    def test_segmented_history_and_adjustment_conflict(self):
        data=history(); data["换手率"]*=100
        for conflict in (False,True):
            calls=[]
            def fetch(**kwargs):
                calls.append(kwargs)
                part=data.loc[data["日期"].between(pd.Timestamp(kwargs["start_date"]),pd.Timestamp(kwargs["end_date"]))].copy()
                if len(calls)==1:
                    return part.tail(500)
                if conflict and len(calls)==3:
                    part[["开盘","收盘","最高","最低"]]*=.5
                return part
            with tempfile.TemporaryDirectory() as directory:
                if conflict:
                    with self.assertRaisesRegex(HistoryDataError,"复权基准不一致"):
                        fetch_sideways_history("002531",AS_OF,self.config,fetch,Path(directory))
                else:
                    result=fetch_sideways_history("002531",AS_OF,self.config,fetch,Path(directory))
                    self.assertEqual(len(result),len(data))
                    self.assertGreater(len(calls),2)

    def test_strength_bypasses_history_and_sideways_failure_is_isolated(self):
        universe=pd.DataFrame([{"代码":"000001","名称":"测试","总市值":20e9,"上市时间":20100101,"板块":"测试","概念":""}])
        with patch.object(screen,"get_stock_universe",return_value=universe), patch.object(screen,"fetch_bottom_k",return_value=sample(True)), patch.object(screen,"fetch_sideways_history",side_effect=AssertionError("转强不取长期数据")) as fetch:
            result=screen.screen_stocks(config=self.config,sleep_seconds=0)
            self.assertEqual(result.iloc[0]["碗型阶段"],"出现转强")
            fetch.assert_not_called()
        with patch.object(screen,"get_stock_universe",return_value=universe), patch.object(screen,"fetch_bottom_k",return_value=sample()), patch.object(screen,"fetch_sideways_history",side_effect=RuntimeError("接口失败")), self.assertLogs(level="INFO") as logs:
            self.assertTrue(screen.screen_stocks(config=self.config,sleep_seconds=0).empty)
        messages=[record.getMessage() for record in logs.records]
        self.assertIn("长期数据未验证: 1",messages)
        self.assertIn("长期数据不通过: 0",messages)

if __name__ == "__main__":
    unittest.main()
