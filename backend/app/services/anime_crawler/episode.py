import logging
import os
import re
from datetime import date

import requests
from bs4 import BeautifulSoup
from sqlalchemy import text
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .db import get_conn, fetch_one

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


def _parse_air_date(text: str) -> str | None:
    m = re.search(r"(\d{4}-\d{1,2}-\d{1,2})", text)
    if m:
        y, mth, d = m.group(1).split("-")
        return f"{int(y):04d}-{int(mth):02d}-{int(d):02d}"
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", text)
    if m:
        y, mth, d = m.groups()
        return f"{int(y):04d}-{int(mth):02d}-{int(d):02d}"
    return None


def crawl_bangumi_episodes(subject_id: int) -> None:
    url = f"{BASE_URL}/subject/{subject_id}/ep"
    logger.info("【章节】开始爬取：%s", url)

    html = _get_html(url)
    soup = BeautifulSoup(html, "html.parser")

    items = soup.select("#episode_list li")
    if not items:
        items = soup.select("#eplist li")
    if not items:
        items = soup.select("#subject_prg_list li")
    if not items:
        items = soup.select("#sectionEp li")
    if not items:
        items = soup.select(".line_list li")
    if not items:
        items = soup.select("[data-ep], [data-episode-no]")

    if not items:
        title = soup.title.get_text(strip=True) if soup.title else ""
        logger.warning("【章节】未解析到章节列表：subject_id=%s title=%s", subject_id, title)
        # 调试：打印关键容器前 300 字符，便于定位结构
        candidates = [
            soup.select_one("#episode_list"),
            soup.select_one("#eplist"),
            soup.select_one("#subject_prg_list"),
            soup.select_one("#sectionEp"),
            soup.select_one(".line_list"),
        ]
        for idx, node in enumerate([c for c in candidates if c]):
            snippet = node.get_text(" ", strip=True)[:300]
            logger.warning("【章节】候选容器[%s]片段：%s", idx, snippet)

    with get_conn() as conn:
        anime = fetch_one(
            conn,
            "SELECT id FROM anime WHERE bgm_subject_id = :sid LIMIT 1",
            {"sid": subject_id},
        )
        if not anime:
            logger.warning("【章节】未找到番剧记录：subject_id=%s", subject_id)
            return

        inserted = 0
        for item in items:
            if item.get("class") and "cat" in item.get("class"):
                continue
            data_ep = item.get("data-ep") or item.get("data-episode-no")
            episode_no = int(data_ep) if data_ep and str(data_ep).isdigit() else None
            if not episode_no:
                ep_tag = item.find(class_="ep") or item.find(class_="sort")
                if ep_tag:
                    m = re.search(r"(\d+)", ep_tag.get_text(strip=True))
                    if m:
                        episode_no = int(m.group(1))
            if not episode_no:
                title_tag = item.find("h6")
                if title_tag:
                    link = title_tag.find("a", href=True)
                    if link:
                        ep_text = link.get_text(strip=True)
                        m = re.match(r"^(\d+)", ep_text)
                        if not m:
                            m = re.match(r"^(\d+)[\\.|\\s]", ep_text)
                        if m:
                            episode_no = int(m.group(1))
            if not episode_no:
                continue

            title_tag = item.find("a", class_="l") or item.find("h6").find("a", href=True) if item.find("h6") else item.find("a", href=True)
            title = title_tag.get_text(strip=True) if title_tag else ""

            air_date = _parse_air_date(item.get_text(" ", strip=True))

            conn.execute(
                text(
                    "INSERT INTO anime_episode (\n"
                    "    anime_id, episode_no, title, air_date\n"
                    ") VALUES (\n"
                    "    :anime_id, :episode_no, :title, :air_date\n"
                    ")\n"
                    "ON CONFLICT (anime_id, episode_no)\n"
                    "DO UPDATE SET\n"
                    "    title = EXCLUDED.title,\n"
                    "    air_date = EXCLUDED.air_date,\n"
                    "    updated_at = NOW();\n"
                ),
                {
                    "anime_id": anime["id"],
                    "episode_no": episode_no,
                    "title": title,
                    "air_date": air_date,
                },
            )
            inserted += 1

            if air_date:
                year, month, day = [int(part) for part in air_date.split("-")]
                weekday = (date(year, month, day).weekday() + 1) % 7
                conn.execute(
                    text(
                        "INSERT INTO anime_airing_calendar (\n"
                        "    anime_id, air_date, weekday, episode_no\n"
                        ") VALUES (\n"
                        "    :anime_id, :air_date, :weekday, :episode_no\n"
                        ")\n"
                        "ON CONFLICT (anime_id, air_date)\n"
                        "DO UPDATE SET\n"
                        "    episode_no = EXCLUDED.episode_no,\n"
                        "    weekday = EXCLUDED.weekday;\n"
                    ),
                    {
                        "anime_id": anime["id"],
                        "air_date": air_date,
                        "weekday": weekday,
                        "episode_no": episode_no,
                    },
                )

    logger.info("【章节】更新完成：subject_id=%s", subject_id)
    if inserted == 0:
        logger.warning("【章节】未写入任何集数：subject_id=%s", subject_id)
