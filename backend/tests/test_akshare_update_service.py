import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from app.services import akshare_update_service as updater


class AKShareUpdateServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.status_path = root / "status.json"
        self.active_path = root / "active.json"
        self.versions_dir = root / "versions"
        self.patches = [
            patch.object(updater, "STATUS_PATH", self.status_path),
            patch.object(updater, "ACTIVE_PATH", self.active_path),
            patch.object(updater, "VERSIONS_DIR", self.versions_dir),
            patch.object(updater, "STATE_DIR", root),
            patch.object(updater, "_update_lock"),
        ]
        for item in self.patches:
            item.start()
        updater._update_lock.acquire.return_value = True

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp_dir.cleanup()

    def read_status(self):
        return json.loads(self.status_path.read_text(encoding="utf-8"))

    def test_daily_check_keeps_installed_version_when_release_lookup_fails(self):
        initial = {"installed_version": "1.18.97", "candidate_version": None}
        updater._write_status(initial)
        with patch.object(updater, "_get_latest_release", side_effect=RuntimeError("offline")), \
             patch.object(updater, "_run_smoke", return_value={"history_rows": 1200}):
            updater.check_and_update_akshare()
        status = self.read_status()
        self.assertEqual(status["installed_version"], "1.18.97")
        self.assertEqual(status["upgrade_status"], "版本查询失败，保留当前版本")
        self.assertEqual(status["interface_status"], "通过")

    def test_candidate_is_not_activated_while_prediction_is_running(self):
        updater._write_status({
            "installed_version": "1.18.97",
            "candidate_version": "1.18.98",
            "upgrade_status": "新版本验证通过，等待空闲切换",
        })
        with patch.object(updater.prediction_task_manager, "get_running_task_id", return_value="task-id"):
            self.assertFalse(updater.activate_if_idle())
        self.assertFalse(self.active_path.exists())
        self.assertIn("预测任务运行中", self.read_status()["upgrade_status"])

    def test_verified_candidate_switches_atomically_when_idle(self):
        self.versions_dir.joinpath("1.18.98", "bin").mkdir(parents=True)
        updater._write_status({
            "installed_version": "1.18.97",
            "candidate_version": "1.18.98",
            "upgrade_status": "新版本验证通过，等待空闲切换",
        })
        with patch.object(updater.prediction_task_manager, "get_running_task_id", return_value=None), \
             patch.dict("os.environ", {"AKSHARE_AUTO_RESTART": "false"}):
            self.assertTrue(updater.activate_if_idle())
        self.assertEqual(json.loads(self.active_path.read_text())["version"], "1.18.98")
        self.assertEqual(self.read_status()["previous_version"], "1.18.97")
        self.assertEqual(self.read_status()["upgrade_status"], "已准备；后端重启后生效")

    def test_status_response_defaults_without_persisted_state(self):
        with patch.object(updater, "_installed_version", return_value="1.18.97"):
            status = updater.get_akshare_status()
        self.assertEqual(status["installed_version"], "1.18.97")
        self.assertEqual(status["interface_status"], "未检查")
        self.assertIsNone(status["last_checked_at"])

    def test_daily_check_activates_candidate_only_after_smoke_test(self):
        with patch.object(updater, "_get_latest_release", return_value=("1.18.98", "release notes")), \
             patch.object(updater, "_installed_version", return_value="1.18.97"), \
             patch.object(updater, "_run_smoke", return_value={"history_rows": 1200}), \
             patch.object(updater, "_prepare_candidate", return_value=(Path("/candidate/python"), {"history_rows": 1200})), \
             patch.object(updater.prediction_task_manager, "get_running_task_id", return_value=None), \
             patch.dict("os.environ", {"AKSHARE_AUTO_RESTART": "false"}):
            updater.check_and_update_akshare()
        self.assertEqual(json.loads(self.active_path.read_text())["version"], "1.18.98")
        status = self.read_status()
        self.assertEqual(status["candidate_version"], "1.18.98")
        self.assertEqual(status["interface_status"], "通过")

    def test_candidate_smoke_failure_keeps_current_version_and_clears_candidate(self):
        updater._write_status({"installed_version": "1.18.97", "candidate_version": None})
        with patch.object(updater, "_get_latest_release", return_value=("1.18.98", None)), \
             patch.object(updater, "_installed_version", return_value="1.18.97"), \
             patch.object(updater, "_run_smoke", return_value={"history_rows": 1200}), \
             patch.object(updater, "_prepare_candidate", side_effect=RuntimeError("history fields missing")):
            updater.check_and_update_akshare()
        status = self.read_status()
        self.assertEqual(status["installed_version"], "1.18.97")
        self.assertIsNone(status["candidate_version"])
        self.assertEqual(status["upgrade_status"], "保留当前版本")
        self.assertIn("history fields missing", status["last_error"])


if __name__ == "__main__":
    unittest.main()
