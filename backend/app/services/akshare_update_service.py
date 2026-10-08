from __future__ import annotations

import json
import logging
import os
import re
import signal
import shutil
import ssl
import subprocess
import sys
import threading
import venv
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from app.services.investment_prediction_service import prediction_task_manager


LOGGER = logging.getLogger(__name__)
STATE_DIR = Path(os.getenv(
    "AKSHARE_STATE_DIR",
    str(Path(__file__).resolve().parents[2] / "data/investment_prediction/akshare"),
))
STATUS_PATH = STATE_DIR / "status.json"
ACTIVE_PATH = STATE_DIR / "active.json"
VERSIONS_DIR = STATE_DIR / "versions"
_update_lock = threading.Lock()
REQUIRED_APIS = (
    "stock_zh_a_spot_tx",
    "stock_info_sh_name_code",
    "stock_info_sz_name_code",
    "stock_info_bj_name_code",
    "stock_profile_cninfo",
    "stock_zh_a_hist_tx",
    "stock_zh_a_daily",
)

_SMOKE_SCRIPT = r'''
import json, sys
import akshare as ak
required = ("stock_zh_a_spot_tx", "stock_info_sh_name_code", "stock_info_sz_name_code", "stock_info_bj_name_code", "stock_profile_cninfo", "stock_zh_a_hist_tx", "stock_zh_a_daily")
missing = [name for name in required if not callable(getattr(ak, name, None))]
if missing:
    raise RuntimeError("missing AKShare APIs: " + ",".join(missing))
spot = ak.stock_zh_a_spot_tx()
for field in ("code", "name", "zxj", "zsz"):
    if field not in spot.columns or spot.empty:
        raise RuntimeError("spot data missing " + field)
for name, args, fields in (
    ("stock_info_sh_name_code", {"symbol": "主板A股"}, ("证券代码", "上市日期")),
    ("stock_info_sz_name_code", {"symbol": "A股列表"}, ("A股代码", "A股上市日期", "所属行业")),
    ("stock_info_bj_name_code", {}, ("证券代码", "上市日期", "所属行业")),
):
    listing = getattr(ak, name)(**args)
    if listing.empty or any(field not in listing.columns for field in fields):
        raise RuntimeError(name + " schema invalid")
info = ak.stock_profile_cninfo(symbol="600519")
if info.empty or not {"上市日期", "所属行业"}.issubset(info.columns):
    raise RuntimeError("company profile schema invalid")
end = __import__("datetime").date.today()
start_recent = end - __import__("datetime").timedelta(days=100)
recent = ak.stock_zh_a_hist_tx(symbol="sh600519", start_date=start_recent.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"), adjust="qfq", timeout=15)
required_bars = ("date", "open", "close", "high", "low", "volume", "amount", "turnover")
if recent.empty or any(field not in recent.columns for field in required_bars):
    raise RuntimeError("daily history schema invalid")
beijing = ak.stock_zh_a_daily(symbol="bj920185", start_date=start_recent.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"), adjust="qfq")
if beijing.empty or any(field not in beijing.columns for field in required_bars):
    raise RuntimeError("Beijing Exchange history schema invalid")
start_long = end - __import__("datetime").timedelta(days=5*366)
long = ak.stock_zh_a_hist_tx(symbol="sh600519", start_date=start_long.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"), adjust="qfq", timeout=15)
if len(long) < 1000:
    raise RuntimeError("long history coverage too short: " + str(len(long)))
if any(field not in long.columns for field in required_bars):
    raise RuntimeError("long history schema invalid")
first_day = __import__("pandas").to_datetime(long["date"], errors="coerce").min().date()
if first_day > start_long + __import__("datetime").timedelta(days=10):
    raise RuntimeError("long history start coverage insufficient: " + str(first_day))
print(json.dumps({"version": str(ak.__version__), "spot_rows": len(spot), "history_rows": len(long)}))
'''


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _network_env() -> dict[str, str]:
    """Use the macOS system roots for Python.org builds without a CA bundle."""
    env = os.environ.copy()
    market_hosts = (
        ".qq.com", ".gtimg.cn", ".sina.com.cn", ".szse.cn", ".sse.com.cn",
        ".bse.cn", ".cninfo.com.cn",
    )
    existing = env.get("NO_PROXY") or env.get("no_proxy") or ""
    bypass = ",".join(dict.fromkeys([item.strip() for item in existing.split(",") if item.strip()] + list(market_hosts)))
    env["NO_PROXY"] = bypass
    env["no_proxy"] = bypass
    if sys.platform != "darwin" or env.get("SSL_CERT_FILE"):
        return env
    bundle = STATE_DIR / "macos-system-roots.pem"
    try:
        if not bundle.is_file() or datetime.now(timezone.utc).timestamp() - bundle.stat().st_mtime > 7 * 86400:
            roots = subprocess.run(
                ["security", "find-certificate", "-a", "-p", "/System/Library/Keychains/SystemRootCertificates.keychain"],
                capture_output=True, timeout=20, check=True,
            ).stdout
            if b"-----BEGIN CERTIFICATE-----" not in roots:
                raise RuntimeError("macOS 系统根证书为空")
            bundle.parent.mkdir(parents=True, exist_ok=True)
            temporary = bundle.with_suffix(f".{os.getpid()}.tmp")
            temporary.write_bytes(roots)
            os.replace(temporary, bundle)
        env["SSL_CERT_FILE"] = str(bundle)
    except Exception as exc:
        LOGGER.warning("读取 macOS 系统根证书失败，将使用 Python 默认信任链: %s", exc)
    return env


def _read_status() -> dict[str, Any]:
    try:
        value = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
        if isinstance(value, dict):
            return value
    except (OSError, ValueError):
        pass
    return {
        "installed_version": _installed_version(),
        "latest_version": None,
        "last_checked_at": None,
        "interface_status": "未检查",
        "upgrade_status": "无待升级版本",
        "last_error": None,
    }


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _write_status(status: dict[str, Any]) -> None:
    _write_json(STATUS_PATH, status)


def _installed_version() -> str:
    try:
        import akshare

        return str(akshare.__version__)
    except Exception:
        return "未安装"


def _load_active_import_path() -> None:
    try:
        active = json.loads(ACTIVE_PATH.read_text(encoding="utf-8"))["version"]
        for site_packages in (VERSIONS_DIR / str(active)).glob("lib/python*/site-packages"):
            value = str(site_packages)
            if value not in sys.path:
                sys.path.insert(0, value)
            return
    except (OSError, ValueError, KeyError, TypeError):
        return


def get_akshare_status() -> dict[str, Any]:
    return _read_status()


def _get_latest_release() -> tuple[str, str | None]:
    network_env = _network_env()
    context = ssl.create_default_context(cafile=network_env["SSL_CERT_FILE"]) if network_env.get("SSL_CERT_FILE") else None
    request = Request(
        "https://pypi.org/pypi/akshare/json",
        headers={"User-Agent": "galileocat-webtool-akshare-updater"},
    )
    with urlopen(request, timeout=15, context=context) as response:
        payload = json.loads(response.read())
    version = str(payload["info"]["version"])
    if not re.fullmatch(r"[0-9]+(?:\.[0-9A-Za-z]+)*", version):
        raise RuntimeError(f"PyPI 返回的 AKShare 版本号格式无效: {version}")
    release_request = Request(
        "https://api.github.com/repos/akfamily/akshare/releases/latest",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "galileocat-webtool"},
    )
    try:
        with urlopen(release_request, timeout=15, context=context) as response:
            release = json.loads(response.read())
        notes = str(release.get("body") or "")[:4000]
    except Exception as exc:
        LOGGER.info("读取 AKShare GitHub 变更说明失败（版本检查仍有效）: %s", exc)
        notes = None
    return version, notes


def _version_python(version: str) -> Path:
    if ACTIVE_PATH.is_file():
        try:
            active = json.loads(ACTIVE_PATH.read_text(encoding="utf-8"))["version"]
            if active == version:
                candidate = VERSIONS_DIR / version / "bin" / "python"
                if candidate.is_file():
                    return candidate
                raise RuntimeError(f"AKShare 已激活版本环境不存在: {version}")
        except (OSError, KeyError, ValueError):
            pass
    return Path(sys.executable)


def _run_smoke(python: Path, timeout: int = 300) -> dict[str, Any]:
    result = subprocess.run(
        [str(python), "-c", _SMOKE_SCRIPT],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env={**_network_env(), "PYTHONUNBUFFERED": "1"},
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "行情冒烟测试失败")[-4000:])
    try:
        return json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as exc:
        raise RuntimeError(f"行情冒烟测试响应无法解析: {result.stdout[-1000:]}") from exc


def _prepare_candidate(version: str) -> tuple[Path, dict[str, Any]]:
    candidate = VERSIONS_DIR / version
    python = candidate / "bin" / "python"
    if python.is_file():
        existing = subprocess.run(
            [str(python), "-c", "import akshare; print(akshare.__version__)"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if existing.returncode or existing.stdout.strip().splitlines()[-1] != version:
            shutil.rmtree(candidate, ignore_errors=True)
    if not python.exists():
        candidate.parent.mkdir(parents=True, exist_ok=True)
        venv.EnvBuilder(with_pip=True, system_site_packages=True, clear=True).create(candidate)
        install = subprocess.run(
            [str(python), "-m", "pip", "install", "--disable-pip-version-check", f"akshare=={version}"],
            capture_output=True,
            text=True,
            timeout=900,
            check=False,
            env=_network_env(),
        )
        if install.returncode:
            shutil.rmtree(candidate, ignore_errors=True)
            raise RuntimeError((install.stderr or install.stdout)[-4000:])
    return python, _run_smoke(python)


def _activate(version: str, status: dict[str, Any]) -> None:
    status["previous_version"] = status.get("installed_version") or _installed_version()
    _write_json(ACTIVE_PATH, {"version": version, "activated_at": _now()})
    status["candidate_version"] = version
    status["upgrade_status"] = "等待后端重启生效"
    status["last_error"] = None
    _write_status(status)
    if os.getenv("AKSHARE_AUTO_RESTART", "false").lower() == "true":
        LOGGER.warning("AKShare %s 已验证，预测任务空闲，向容器发送安全重启信号", version)
        os.kill(os.getpid(), signal.SIGTERM)
    else:
        status["upgrade_status"] = "已准备；后端重启后生效"
        _write_status(status)


def activate_if_idle() -> bool:
    status = _read_status()
    version = status.get("candidate_version")
    if not version:
        return False
    if status.get("upgrade_status") == "已准备；后端重启后生效":
        return False
    if prediction_task_manager.get_running_task_id():
        status["upgrade_status"] = "升级待生效：预测任务运行中"
        _write_status(status)
        return False
    _activate(str(version), status)
    return True


def check_and_update_akshare() -> None:
    if not _update_lock.acquire(blocking=False):
        return
    try:
        status = _read_status()
        status["last_checked_at"] = _now()
        status["interface_source"] = "akshare_tx_v1"
        status["interface_status"] = "检查中"
        status["upgrade_status"] = "检查中"
        _write_status(status)
        current = status.get("installed_version") or _installed_version()
        status["installed_version"] = current
        release_error = None
        try:
            latest, notes = _get_latest_release()
            status["latest_version"] = latest
            status["release_notes"] = notes
        except Exception as exc:
            release_error = str(exc)
            status["latest_version"] = None
        interface_error = None
        try:
            active_python = _version_python(str(current))
            smoke = _run_smoke(active_python)
            status["interface_status"] = "通过"
            status["interface_checked_at"] = _now()
            status["active_smoke_test"] = smoke
        except Exception as exc:
            interface_error = str(exc)
            status["interface_status"] = "检查失败"
            status["active_smoke_test"] = None
        if release_error:
            status["upgrade_status"] = "版本查询失败，保留当前版本"
            status["last_error"] = "; ".join(filter(None, (release_error, interface_error)))[:4000]
            _write_status(status)
            LOGGER.warning("AKShare 发布版本查询失败，接口检查结果已单独记录: %s", release_error)
            return
        try:
            if latest == current:
                status["upgrade_status"] = "已是最新版本"
                status["candidate_version"] = None
                status["last_error"] = interface_error
                _write_status(status)
                return
            python, candidate_smoke = _prepare_candidate(latest)
            del python
            status["candidate_version"] = latest
            status["candidate_smoke_test"] = candidate_smoke
            status["upgrade_status"] = "新版本验证通过，等待空闲切换"
            status["last_error"] = interface_error
            _write_status(status)
            activate_if_idle()
        except Exception as exc:
            status["upgrade_status"] = "保留当前版本"
            status["candidate_version"] = None
            status["last_error"] = "; ".join(filter(None, (interface_error, str(exc))))[:4000]
            _write_status(status)
            LOGGER.exception("AKShare 每日版本/接口检查失败，继续保留当前版本")
    finally:
        _update_lock.release()


def on_backend_startup() -> None:
    _load_active_import_path()
    status = _read_status()
    if ACTIVE_PATH.is_file():
        try:
            active = json.loads(ACTIVE_PATH.read_text(encoding="utf-8"))["version"]
            python = VERSIONS_DIR / str(active) / "bin" / "python"
            check = subprocess.run(
                [str(python), "-c", "import akshare; print(akshare.__version__); assert all(callable(getattr(akshare, n, None)) for n in " + repr(REQUIRED_APIS) + ")"],
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )
            if check.returncode or check.stdout.strip().splitlines()[-1] != str(active):
                previous = status.get("previous_version")
                if previous and previous != "未安装":
                    previous_python = VERSIONS_DIR / str(previous) / "bin" / "python"
                    if previous_python.is_file():
                        _write_json(ACTIVE_PATH, {"version": previous, "activated_at": _now()})
                    else:
                        ACTIVE_PATH.unlink(missing_ok=True)
                else:
                    ACTIVE_PATH.unlink(missing_ok=True)
                failed_path = str(VERSIONS_DIR / str(active) / "lib")
                sys.path[:] = [entry for entry in sys.path if not entry.startswith(failed_path)]
                _load_active_import_path()
                status["installed_version"] = previous or "基线版本"
                status["candidate_version"] = None
                status["upgrade_status"] = "启动验证失败，已回滚"
                status["last_error"] = (check.stderr or check.stdout or "AKShare 启动校验失败")[-4000:]
                _write_status(status)
                return
            status["installed_version"] = active
            status["candidate_version"] = None
            status["upgrade_status"] = "已激活"
            status["activated_at"] = _now()
            _write_status(status)
        except (OSError, ValueError, KeyError, RuntimeError) as exc:
            previous = status.get("previous_version")
            previous_python = VERSIONS_DIR / str(previous) / "bin" / "python" if previous else None
            if previous_python and previous_python.is_file():
                _write_json(ACTIVE_PATH, {"version": previous, "activated_at": _now()})
            else:
                ACTIVE_PATH.unlink(missing_ok=True)
            status["installed_version"] = previous or _installed_version()
            status["candidate_version"] = None
            status["upgrade_status"] = "启动验证失败，已回滚"
            status["last_error"] = str(exc)[:4000]
            _write_status(status)
            LOGGER.exception("AKShare 激活版本启动校验失败，已回滚")
    else:
        status["installed_version"] = _installed_version()
        _write_status(status)
