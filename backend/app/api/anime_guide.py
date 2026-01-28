from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import get_current_user
from app.services.anime_crawler.db import fetch_all, fetch_one, get_conn

router = APIRouter(prefix="/tools/anime-guide", tags=["anime-guide"])

WEEKDAY_TEXT = {
    0: "星期日",
    1: "星期一",
    2: "星期二",
    3: "星期三",
    4: "星期四",
    5: "星期五",
    6: "星期六",
}


def _format_date_cn(value: date | None) -> str | None:
    if not value:
        return None
    return f"{value.year}年{value.month}月{value.day}日"


def _rating_to_five(value: float | None) -> float:
    if value is None:
        return 0.0
    numeric = float(value)
    return round(min(max(numeric / 2.0, 0.0), 5.0), 1)


@router.get("/calendar")
def get_calendar_dates(
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT DISTINCT air_date
            FROM anime_airing_calendar
            WHERE air_date BETWEEN :start AND :end
            ORDER BY air_date;
            """,
            {"start": start, "end": end},
        )
    return {"dates": [row["air_date"].isoformat() for row in rows]}


@router.get("/crawl-status")
def get_crawl_status(current_user: dict = Depends(get_current_user)) -> dict:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            """
            SELECT MAX(last_crawled_at) AS last_crawled_at
            FROM anime
            WHERE last_crawled_at IS NOT NULL;
            """,
            {},
        )
    last = row.get("last_crawled_at") if row else None
    return {"lastCrawledAt": last.isoformat() if last else None}


@router.get("/updates")
def get_updates_by_date(
    date_str: str = Query(..., alias="date"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
                a.bgm_subject_id,
                a.title,
                a.title_zh,
                a.rating,
                a.cover_image_url,
                c.weekday,
                c.air_date,
                COALESCE(c.episode_no, e.episode_no, em.max_episode) AS episode_no
            FROM anime_airing_calendar c
            JOIN anime a ON a.id = c.anime_id
            LEFT JOIN anime_episode e
                ON e.anime_id = c.anime_id
               AND e.air_date = c.air_date
            LEFT JOIN LATERAL (
                SELECT MAX(episode_no) AS max_episode
                FROM anime_episode
                WHERE anime_id = c.anime_id
            ) em ON true
            WHERE c.air_date = :air_date
            ORDER BY a.rating DESC NULLS LAST;
            """,
            {"air_date": date_str},
        )
    items = []
    for row in rows:
        episode_no = row.get("episode_no")
        items.append(
            {
                "id": str(row["bgm_subject_id"]),
                "title": row.get("title") or "",
                "chineseTitle": row.get("title_zh") or "",
                "originalTitle": row.get("title") or "",
                "coverUrl": row.get("cover_image_url") or "",
                "weekday": row.get("weekday"),
                "date": row.get("air_date").isoformat() if row.get("air_date") else date_str,
                "episode": f"第{episode_no}集" if episode_no else None,
                "rating": _rating_to_five(row.get("rating")),
                "updateTime": None,
            }
        )
    return {"items": items}


@router.get("/weekday")
def get_by_weekday(
    weekday: int = Query(..., ge=0, le=6),
    current_user: dict = Depends(get_current_user),
) -> dict:
    with get_conn() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
                a.bgm_subject_id,
                a.title,
                a.title_zh,
                a.rating,
                a.cover_image_url,
                a.weekday,
                em.max_episode
            FROM anime a
            LEFT JOIN LATERAL (
                SELECT MAX(episode_no) AS max_episode
                FROM anime_episode
                WHERE anime_id = a.id
            ) em ON true
            WHERE a.weekday = :weekday
            ORDER BY rating DESC NULLS LAST;
            """,
            {"weekday": weekday},
        )
    items = [
        {
            "id": str(row["bgm_subject_id"]),
            "title": row.get("title") or "",
            "chineseTitle": row.get("title_zh") or "",
            "originalTitle": row.get("title") or "",
            "coverUrl": row.get("cover_image_url") or "",
            "weekday": row.get("weekday"),
            "date": "",
            "episode": f"第{row['max_episode']}集" if row.get("max_episode") else None,
            "rating": _rating_to_five(row.get("rating")),
            "updateTime": None,
        }
        for row in rows
    ]
    return {"items": items}


@router.get("/detail/{subject_id}")
def get_detail(subject_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    with get_conn() as conn:
        anime = fetch_one(
            conn,
            """
            SELECT
                id,
                bgm_subject_id,
                title,
                title_zh,
                summary,
                start_date,
                weekday,
                total_episodes,
                rating,
                cover_image_url
            FROM anime
            WHERE bgm_subject_id = :sid
            LIMIT 1;
            """,
            {"sid": subject_id},
        )
        if not anime:
            raise HTTPException(status_code=404, detail="Not Found")

        episodes = fetch_all(
            conn,
            """
            SELECT episode_no
            FROM anime_episode
            WHERE anime_id = :anime_id
            ORDER BY episode_no ASC;
            """,
            {"anime_id": anime["id"]},
        )

    episode_list = [row["episode_no"] for row in episodes]
    total_episodes = anime.get("total_episodes") or 0
    if total_episodes:
        episode_list = list(range(1, total_episodes + 1))

    detail: dict[str, Any] = {
        "id": str(anime["bgm_subject_id"]),
        "title": anime.get("title") or "",
        "coverUrl": anime.get("cover_image_url") or "",
        "chineseTitle": anime.get("title_zh") or "",
        "totalEpisodes": total_episodes,
        "startDate": _format_date_cn(anime.get("start_date")),
        "weekdayText": WEEKDAY_TEXT.get(anime.get("weekday"), ""),
        "episodes": episode_list,
        "synopsis": anime.get("summary") or "",
        "rating": _rating_to_five(anime.get("rating")),
    }

    return {"detail": detail}
