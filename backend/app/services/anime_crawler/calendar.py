import logging
from datetime import date, timedelta
from typing import List

from bs4 import BeautifulSoup
from sqlalchemy import text

from .http_client import fetch_bangumi_html
from .db import get_conn, fetch_one

logger = logging.getLogger(__name__)

BASE_URL = "https://bgm.tv"
CALENDAR_URL = f"{BASE_URL}/calendar"

WEEKDAY_MAP = {
    "星期日": 0,
    "周日": 0,
    "星期天": 0,
    "星期一": 1,
    "周一": 1,
    "星期二": 2,
    "周二": 2,
    "星期三": 3,
    "周三": 3,
    "星期四": 4,
    "周四": 4,
    "星期五": 5,
    "周五": 5,
    "星期六": 6,
    "周六": 6,
}


def _get_html(url: str) -> str:
    # 强制按 UTF-8 解码，避免 weekday 标题乱码导致解析失败。
    html, final_url = fetch_bangumi_html(url, logger=logger, log_label="日历")
    logger.info("【日历】请求成功：%s", final_url)
    return html


def _parse_weekday(text: str) -> int | None:
    for key, val in WEEKDAY_MAP.items():
        if key in text:
            return val
    return None


def crawl_bangumi_calendar() -> List[int]:
    logger.info("【日历】开始爬取：/calendar")
    html = _get_html("/calendar")
    soup = BeautifulSoup(html, "html.parser")
    day_blocks = soup.select("ul.coverList")
    if not day_blocks:
        fallback_url = "https://bangumi.tv/calendar"
        logger.warning("【日历】未解析到 coverList，尝试备用域名：%s", fallback_url)
        html = _get_html(fallback_url)
        soup = BeautifulSoup(html, "html.parser")

    subject_ids: List[int] = []
    today = date.today()
    day_blocks = soup.select("ul.coverList")
    logger.info("【日历】解析 coverList 数量=%s", len(day_blocks))

    with get_conn() as conn:
        # Python: Monday=0 ... Sunday=6; we map Sunday=0...Saturday=6
        sunday_offset = (today.weekday() + 1) % 7
        week_start = today - timedelta(days=sunday_offset)
        week_end = week_start + timedelta(days=6)

        for block in day_blocks:
            header = block.find_previous("h3") or block.find_previous(["h2", "h4"])
            if not header:
                continue
            weekday = _parse_weekday(header.get_text(strip=True))
            if weekday is None:
                continue

            for li in block.select("li"):
                link = li.find("a", href=True)
                if not link or "/subject/" not in link["href"]:
                    continue

                bgm_url = link["href"]
                if not bgm_url.startswith("http"):
                    bgm_url = f"{BASE_URL}{bgm_url}"

                subject_id = None
                try:
                    subject_id = int(bgm_url.split("/subject/")[1].split("/")[0])
                except Exception:
                    continue

                title = ""
                em = li.find("em")
                if em:
                    title = em.get_text(strip=True)
                if not title:
                    nav = li.find("a", class_="nav")
                    title = nav.get_text(strip=True) if nav else link.get_text(strip=True)

                cover_image_url = ""
                style = li.get("style", "")
                if "url(" in style:
                    start = style.find("url(") + 4
                    end = style.find(")", start)
                    cover_image_url = style[start:end].strip("'\"") if end > start else ""
                if cover_image_url.startswith("//"):
                    cover_image_url = f"https:{cover_image_url}"

                conn.execute(
                    text(
                        "INSERT INTO anime (\n"
                        "    bgm_subject_id, bgm_url, title, cover_image_url, weekday\n"
                        ") VALUES (\n"
                        "    :bgm_subject_id, :bgm_url, :title, :cover_image_url, :weekday\n"
                        ")\n"
                        "ON CONFLICT (bgm_subject_id)\n"
                        "DO UPDATE SET\n"
                        "    bgm_url = EXCLUDED.bgm_url,\n"
                        "    title = EXCLUDED.title,\n"
                        "    cover_image_url = EXCLUDED.cover_image_url,\n"
                        "    weekday = EXCLUDED.weekday,\n"
                        "    updated_at = NOW();\n"
                    ),
                    {
                        "bgm_subject_id": subject_id,
                        "bgm_url": bgm_url,
                        "title": title,
                        "cover_image_url": cover_image_url,
                        "weekday": weekday,
                    },
                )

                row = fetch_one(
                    conn,
                    "SELECT id FROM anime WHERE bgm_subject_id = :sid LIMIT 1",
                    {"sid": subject_id},
                )
                if row:
                    air_date = week_start + timedelta(days=weekday)
                    conn.execute(
                        text(
                            "INSERT INTO anime_airing_calendar (\n"
                            "    anime_id, air_date, weekday\n"
                            ") VALUES (\n"
                            "    :anime_id, :air_date, :weekday\n"
                            ")\n"
                            "ON CONFLICT (anime_id, air_date)\n"
                            "DO UPDATE SET\n"
                            "    weekday = EXCLUDED.weekday,\n"
                            "    episode_no = COALESCE(anime_airing_calendar.episode_no, EXCLUDED.episode_no);\n"
                        ),
                        {
                            "anime_id": row["id"],
                            "air_date": air_date.isoformat(),
                            "weekday": weekday,
                        },
                    )

                if subject_id not in subject_ids:
                    subject_ids.append(subject_id)

    if not subject_ids:
        logger.warning("【日历】未发现番剧，页面可能变更或被拦截")
    logger.info("【日历】完成，本次发现番剧数=%s", len(subject_ids))
    return subject_ids
