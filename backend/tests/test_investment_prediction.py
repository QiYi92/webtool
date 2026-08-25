import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.api import investment_prediction as api
from app.core.security import get_current_user
from app.services import investment_prediction_service as service


class InvestmentPredictionServiceTests(unittest.TestCase):
    def test_strategy_discovery_and_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_dir = root / "configs"
            config_dir.mkdir()
            (config_dir / "default_bowl.json").write_text("{}", encoding="utf-8")
            (config_dir / "default_bowl_v2.json").write_text("{}", encoding="utf-8")
            (config_dir / "notes.txt").write_text("ignore", encoding="utf-8")

            with patch.object(service, "STOCK_SCREEN_ROOT", root):
                self.assertEqual(
                    service.list_strategies(),
                    ["default_bowl", "default_bowl_v2"],
                )
                self.assertEqual(
                    service.resolve_strategy_path("default_bowl_v2").name,
                    "default_bowl_v2.json",
                )
                with self.assertRaises(ValueError):
                    service.resolve_strategy_path("../default_bowl")

    def test_result_normalization_classification_and_deduplication(self) -> None:
        result = pd.DataFrame(
            [
                {
                    "股票代码": 1.0,
                    "股票名称": "平安银行",
                    "板块": "银行",
                    "碗型阶段": "右侧萌芽",
                },
                {
                    "股票代码": "000001",
                    "股票名称": "平安银行",
                    "板块": "银行",
                    "碗型阶段": "早期启动",
                },
                {
                    "股票代码": "688981",
                    "股票名称": "中芯国际",
                    "板块": "半导体",
                    "碗型阶段": "右侧萌芽",
                },
            ]
        )

        rows = service._result_rows(result)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["stock_code"], "000001")
        self.assertEqual(rows[0]["stock_category"], "深市主板")
        self.assertEqual(rows[0]["bowl_stage"], "早期启动")
        self.assertEqual(rows[1]["stock_category"], "科创板")

    def test_invalid_stock_code_rejected(self) -> None:
        with self.assertRaises(ValueError):
            service.normalize_stock_code("SH600519")

    def test_empty_result_is_supported(self) -> None:
        result = pd.DataFrame(
            columns=["股票代码", "股票名称", "板块", "碗型阶段"]
        )
        self.assertEqual(service._result_rows(result), [])

    def test_filter_settings_are_mapped_to_screening_overrides(self) -> None:
        overrides = service.build_filter_config_overrides(
            {
                "exclude_gem": False,
                "exclude_star_market": True,
                "exclude_insufficient_listing": False,
                "exclude_failed_year_trend": True,
                "exclude_insufficient_kline": False,
                "exclude_failed_volume": True,
                "exclude_failed_bowl": False,
            }
        )

        self.assertEqual(
            overrides["basic"]["excluded_board_prefixes"],
            ["688", "689"],
        )
        self.assertFalse(overrides["basic"]["enable_listing_filter"])
        self.assertTrue(overrides["basic"]["enable_trend_filter"])
        self.assertFalse(overrides["basic"]["enable_k_data_filter"])
        self.assertTrue(overrides["basic"]["enable_volume_filter"])
        self.assertFalse(overrides["basic"]["enable_bowl_filter"])

    def test_restart_marks_unfinished_task_as_failed(self) -> None:
        manager = service.PredictionTaskManager()
        unfinished = {
            "id": "b297f610-739e-4162-b96b-a9804cdd48f2",
            "started_at": datetime.now(timezone.utc),
            "finished_at": None,
            "hit_count": 0,
        }
        with patch.object(service, "get_latest_task", return_value=unfinished):
            snapshot = manager.snapshot()

        self.assertEqual(snapshot["status"], "failed")
        self.assertIn("任务中断", snapshot["error_message"])

    def test_task_artifacts_are_deleted(self) -> None:
        task_id = "b297f610-739e-4162-b96b-a9804cdd48f2"
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_dir = root / "logs"
            data_dir = root / "data"
            log_dir.mkdir()
            data_dir.mkdir()
            log_path = log_dir / f"{task_id}.log"
            output_path = data_dir / f"{task_id}.xlsx"
            log_path.write_text("test", encoding="utf-8")
            output_path.write_bytes(b"test")

            with (
                patch.object(service, "LOG_DIR", log_dir),
                patch.object(service, "DATA_DIR", data_dir),
            ):
                service.delete_task_artifacts([task_id])

            self.assertFalse(log_path.exists())
            self.assertFalse(output_path.exists())

    def test_report_path_uses_normalized_task_id(self) -> None:
        task_id = "B297F610-739E-4162-B96B-A9804Cdd48f2"
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            service, "DATA_DIR", Path(temp_dir)
        ):
            report_path = service.get_report_path(task_id)

        self.assertEqual(report_path.name, "b297f610-739e-4162-b96b-a9804cdd48f2.xlsx")


class InvestmentPredictionApiTests(unittest.TestCase):
    def build_client(self, role_group: str | None) -> TestClient:
        app = FastAPI()
        app.include_router(api.router)
        if role_group is not None:
            app.dependency_overrides[get_current_user] = lambda: {
                "id": "test-user",
                "role_group": role_group,
            }
        return TestClient(app)

    @patch.object(
        api,
        "list_strategies",
        return_value=["default_bowl", "default_bowl_v2"],
    )
    def test_all_authenticated_roles_can_list_strategies(self, _: object) -> None:
        for role in ("admin", "member", "viewer"):
            with self.subTest(role=role), self.build_client(role) as client:
                response = client.get("/tools/investment-prediction/strategies")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json()["default_strategy"],
                    "default_bowl_v2",
                )

    def test_anonymous_request_is_rejected(self) -> None:
        with self.build_client(None) as client:
            response = client.get("/tools/investment-prediction/strategies")
            delete_response = client.request(
                "DELETE",
                "/tools/investment-prediction/tasks",
                json={
                    "task_ids": ["b297f610-739e-4162-b96b-a9804cdd48f2"]
                },
            )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(delete_response.status_code, 401)

    def test_running_task_returns_conflict(self) -> None:
        with (
            patch.object(
                api.prediction_task_manager,
                "start",
                side_effect=RuntimeError("已有投资走势预测任务正在运行"),
            ),
            self.build_client("member") as client,
        ):
            response = client.post(
                "/tools/investment-prediction/run",
                json={"strategy": "default_bowl_v2"},
            )
        self.assertEqual(response.status_code, 409)

    def test_run_uses_default_and_custom_filter_settings(self) -> None:
        task_id = "b297f610-739e-4162-b96b-a9804cdd48f2"
        with (
            patch.object(
                api.prediction_task_manager,
                "start",
                return_value=task_id,
            ) as start_mock,
            self.build_client("member") as client,
        ):
            default_response = client.post(
                "/tools/investment-prediction/run",
                json={"strategy": "default_bowl_v2"},
            )
            custom_response = client.post(
                "/tools/investment-prediction/run",
                json={
                    "strategy": "default_bowl_v2",
                    "filters": {
                        "exclude_gem": False,
                        "exclude_failed_bowl": False,
                    },
                },
            )

        self.assertEqual(default_response.status_code, 200)
        self.assertEqual(custom_response.status_code, 200)
        default_filters = start_mock.call_args_list[0].args[1]
        custom_filters = start_mock.call_args_list[1].args[1]
        self.assertTrue(all(default_filters.values()))
        self.assertFalse(custom_filters["exclude_gem"])
        self.assertFalse(custom_filters["exclude_failed_bowl"])
        self.assertTrue(custom_filters["exclude_star_market"])

    def test_invalid_strategy_returns_bad_request(self) -> None:
        with (
            patch.object(
                api.prediction_task_manager,
                "start",
                side_effect=ValueError("策略不存在"),
            ),
            self.build_client("member") as client,
        ):
            response = client.post(
                "/tools/investment-prediction/run",
                json={"strategy": "missing"},
            )
        self.assertEqual(response.status_code, 400)

    def test_invalid_task_id_returns_bad_request(self) -> None:
        with self.build_client("member") as client:
            response = client.get(
                "/tools/investment-prediction/tasks/not-a-uuid/results"
            )
        self.assertEqual(response.status_code, 400)

    def test_report_download_returns_original_xlsx(self) -> None:
        task_id = "b297f610-739e-4162-b96b-a9804cdd48f2"
        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / f"{task_id}.xlsx"
            report_path.write_bytes(b"xlsx-content")
            with (
                patch.object(api, "get_task", return_value={"id": task_id}),
                patch.object(api, "get_report_path", return_value=report_path),
                self.build_client("member") as client,
            ):
                response = client.get(
                    f"/tools/investment-prediction/tasks/{task_id}/report"
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"xlsx-content")
        self.assertIn("attachment", response.headers["content-disposition"])

    @patch.object(api, "list_tasks")
    def test_all_authenticated_roles_can_list_history(self, list_tasks_mock) -> None:
        list_tasks_mock.return_value = (
            1,
            [
                {
                    "id": "b297f610-739e-4162-b96b-a9804cdd48f2",
                    "started_at": datetime.now(timezone.utc),
                    "finished_at": None,
                    "hit_count": 0,
                }
            ],
        )
        for role in ("admin", "member", "viewer"):
            with self.subTest(role=role), self.build_client(role) as client:
                response = client.get(
                    "/tools/investment-prediction/tasks?page=1&page_size=15"
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["total"], 1)
                self.assertEqual(len(response.json()["items"]), 1)

    def test_history_pagination_is_validated(self) -> None:
        with self.build_client("member") as client:
            invalid_page = client.get(
                "/tools/investment-prediction/tasks?page=0&page_size=15"
            )
            invalid_size = client.get(
                "/tools/investment-prediction/tasks?page=1&page_size=51"
            )
        self.assertEqual(invalid_page.status_code, 422)
        self.assertEqual(invalid_size.status_code, 422)

    def test_history_database_error_returns_service_unavailable(self) -> None:
        with (
            patch.object(
                api,
                "list_tasks",
                side_effect=SQLAlchemyError("database unavailable"),
            ),
            self.build_client("member") as client,
        ):
            response = client.get("/tools/investment-prediction/tasks")
        self.assertEqual(response.status_code, 503)

    def test_all_authenticated_roles_can_delete_history(self) -> None:
        task_id = "b297f610-739e-4162-b96b-a9804cdd48f2"
        for role in ("admin", "member", "viewer"):
            with (
                self.subTest(role=role),
                patch.object(
                    api.prediction_task_manager,
                    "get_running_task_id",
                    return_value=None,
                ),
                patch.object(api, "delete_tasks", return_value=[task_id]) as delete_mock,
                patch.object(api, "delete_task_artifacts") as artifact_mock,
                patch.object(
                    api.prediction_task_manager,
                    "forget_deleted_tasks",
                ) as forget_mock,
                self.build_client(role) as client,
            ):
                response = client.request(
                    "DELETE",
                    "/tools/investment-prediction/tasks",
                    json={"task_ids": [task_id]},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["deleted_count"], 1)
                delete_mock.assert_called_once_with([task_id])
                artifact_mock.assert_called_once_with([task_id])
                forget_mock.assert_called_once_with([task_id])

    def test_running_history_task_cannot_be_deleted(self) -> None:
        task_id = "b297f610-739e-4162-b96b-a9804cdd48f2"
        with (
            patch.object(
                api.prediction_task_manager,
                "get_running_task_id",
                return_value=task_id,
            ),
            patch.object(api, "delete_tasks") as delete_mock,
            self.build_client("member") as client,
        ):
            response = client.request(
                "DELETE",
                "/tools/investment-prediction/tasks",
                json={"task_ids": [task_id]},
            )
        self.assertEqual(response.status_code, 409)
        delete_mock.assert_not_called()

    def test_delete_history_validates_task_ids(self) -> None:
        with self.build_client("member") as client:
            invalid_id = client.request(
                "DELETE",
                "/tools/investment-prediction/tasks",
                json={"task_ids": ["not-a-uuid"]},
            )
            empty_list = client.request(
                "DELETE",
                "/tools/investment-prediction/tasks",
                json={"task_ids": []},
            )
        self.assertEqual(invalid_id.status_code, 400)
        self.assertEqual(empty_list.status_code, 422)

    def test_delete_history_database_error_returns_service_unavailable(self) -> None:
        task_id = "b297f610-739e-4162-b96b-a9804cdd48f2"
        with (
            patch.object(
                api.prediction_task_manager,
                "get_running_task_id",
                return_value=None,
            ),
            patch.object(
                api,
                "delete_tasks",
                side_effect=SQLAlchemyError("database unavailable"),
            ),
            self.build_client("member") as client,
        ):
            response = client.request(
                "DELETE",
                "/tools/investment-prediction/tasks",
                json={"task_ids": [task_id]},
            )
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
