import logging
import os
import re
from datetime import datetime

import requests
from bs4 import BeautifulSoup
from sqlalchemy import text
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .db import get_conn

logger = logging.getLogger(__name__)

BASE_URL = "https://bangumi.tv"


def _build_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    verify_env = os.getenv("BANGUMI_SSL_VERIFY", "1").lower()
    if verify_env in ("0", "false", "no"):
        session.verify = False
    ca_bundle = os.getenv("BANGUMI_CA_BUNDLE")
    if ca_bundle:
        session.verify = ca_bundle

    retries = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def _get_html(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; galileocat-webtool/1.0; +https://bangumi.tv)",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    session = _build_session()
    resp = session.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    return resp.content.decode("utf-8", errors="ignore")


def _parse_infobox(soup: BeautifulSoup) -> dict:
    info = {}
    box = soup.find(id="infobox")
    if not box:
        return info
    for li in box.find_all("li"):
        tip = li.find("span", class_="tip")
        if not tip:
            continue
        label = tip.get_text(strip=True).rstrip(":")
        value = li.get_text(" ", strip=True).replace(tip.get_text(strip=True), "", 1).strip(" :")
        info[label] = value
    return info


def _normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return value
    match = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", value)
    if match:
        y, m, d = match.groups()
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    return None


def crawl_bangumi_subject(subject_id: int) -> None:
    url = f"{BASE_URL}/subject/{subject_id}"
    logger.info("【详情】开始爬取：%s", url)

    html = _get_html(url)
    soup = BeautifulSoup(html, "html.parser")
    info = _parse_infobox(soup)

    title_zh = info.get("中文名") or info.get("中文")
    summary_node = soup.select_one("#subject_summary")
    summary = summary_node.get_text("\n", strip=True) if summary_node else None

    start_date = _normalize_date(info.get("放送开始"))
    total_episodes = None
    total_text = info.get("话数") or info.get("集数") or ""
    if total_text:
        digits = "".join([c for c in total_text if c.isdigit()])
        if digits:
            total_episodes = int(digits)

    rating_value = None
    rating_count = None
    rating_node = soup.select_one(".global_score .number") or soup.select_one(
        "#panelInterest span.number"
    )
    if rating_node:
        try:
            rating_value = float(rating_node.get_text(strip=True))
        except Exception:
            rating_value = None
    count_node = (
        soup.select_one('[property="v:votes"]')
        or soup.select_one("#panelInterest span#rating_total")
        or soup.select_one("#panelInterest span.people")
        or soup.select_one(".global_score .total")
        or soup.select_one(".global_score .people")
    )
    if count_node:
        if count_node.has_attr("content"):
            try:
                rating_count = int(count_node["content"])
            except Exception:
                rating_count = None
        if rating_count is None:
            match = re.search(r"(\d+)", count_node.get_text(strip=True))
            if match:
                rating_count = int(match.group(1))
    if rating_count is None:
        chart = soup.select_one("#ChartWarpper")
        if chart:
            match = re.search(r"(\d+)\\s+votes", chart.get_text(" ", strip=True))
            if match:
                rating_count = int(match.group(1))

    payload = {
        "bgm_subject_id": subject_id,
        "title_zh": title_zh,
        "summary": summary,
        "start_date": start_date,
        "total_episodes": total_episodes,
        "rating": rating_value,
        "rating_count": rating_count,
        "last_crawled_at": datetime.utcnow().isoformat(),
    }

    with get_conn() as conn:
        conn.execute(
            text(
                "UPDATE anime\n"
                "SET\n"
                "    title_zh = COALESCE(:title_zh, title_zh),\n"
                "    summary = COALESCE(:summary, summary),\n"
                "    start_date = COALESCE(:start_date, start_date),\n"
                "    total_episodes = COALESCE(:total_episodes, total_episodes),\n"
                "    rating = COALESCE(:rating, rating),\n"
                "    rating_count = COALESCE(:rating_count, rating_count),\n"
                "    last_crawled_at = :last_crawled_at,\n"
                "    updated_at = NOW()\n"
                "WHERE bgm_subject_id = :bgm_subject_id\n"
            ),
            payload,
        )

    logger.info("【详情】更新完成：subject_id=%s", subject_id)
