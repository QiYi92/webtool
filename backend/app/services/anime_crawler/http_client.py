import os
from logging import Logger
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_BANGUMI_BASE_URLS = ("https://bgm.tv", "https://bangumi.tv")


def _env_enabled(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "false", "no", "off")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def get_bangumi_base_urls() -> list[str]:
    raw = os.getenv("BANGUMI_BASE_URLS", "").strip()
    if not raw:
        return list(DEFAULT_BANGUMI_BASE_URLS)
    urls = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
    return urls or list(DEFAULT_BANGUMI_BASE_URLS)


def build_bangumi_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = _env_enabled("BANGUMI_TRUST_ENV_PROXY", "0")

    proxy_url = os.getenv("BANGUMI_PROXY", "").strip()
    if proxy_url:
        session.proxies.update({"http": proxy_url, "https": proxy_url})

    verify_env = os.getenv("BANGUMI_SSL_VERIFY", "1").lower()
    if verify_env in ("0", "false", "no"):
        session.verify = False
    ca_bundle = os.getenv("BANGUMI_CA_BUNDLE")
    if ca_bundle:
        session.verify = ca_bundle

    retries = Retry(
        total=2,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def fetch_bangumi_html(
    path_or_url: str,
    *,
    logger: Logger,
    log_label: str,
    timeout: tuple[float, float] | None = None,
) -> tuple[str, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; galileocat-webtool/1.0; +https://bgm.tv)",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    parsed = urlparse(path_or_url)
    urls = [path_or_url] if parsed.scheme else [
        f"{base}{path_or_url if path_or_url.startswith('/') else f'/{path_or_url}'}"
        for base in get_bangumi_base_urls()
    ]

    last_exc: Exception | None = None
    request_timeout = timeout or (
        _env_float("BANGUMI_CONNECT_TIMEOUT", 8),
        _env_float("BANGUMI_READ_TIMEOUT", 20),
    )
    for idx, url in enumerate(urls):
        try:
            session = build_bangumi_session()
            resp = session.get(url, headers=headers, timeout=request_timeout)
            resp.raise_for_status()
            return resp.content.decode("utf-8", errors="ignore"), url
        except requests.RequestException as exc:
            last_exc = exc
            if idx < len(urls) - 1:
                logger.warning("【%s】请求失败，尝试备用地址：url=%s error=%s", log_label, url, exc)
            else:
                logger.error("【%s】请求失败，已无备用地址：url=%s error=%s", log_label, url, exc)

    if last_exc:
        raise last_exc
    raise RuntimeError(f"No Bangumi URL configured for {path_or_url}")
