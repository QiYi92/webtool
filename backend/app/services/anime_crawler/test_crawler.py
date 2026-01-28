import os
import sys
import os
import re

CURRENT_DIR = os.path.dirname(__file__)
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "../../.."))
if CURRENT_DIR in sys.path:
    sys.path.remove(CURRENT_DIR)
sys.path.insert(0, PROJECT_ROOT)

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def fetch(url: str) -> BeautifulSoup:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Connection": "keep-alive",
        "Referer": "https://bangumi.tv/",
    }
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

    resp = session.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    html = resp.content.decode("utf-8", errors="ignore")
    return BeautifulSoup(html, "html.parser")


def debug_calendar(url: str) -> int:
    print(f"\n=== 测试 URL: {url} ===")
    soup = fetch(url)
    title = soup.title.get_text(strip=True) if soup.title else "(no title)"
    html = str(soup)
    subject_count = html.count("/subject/")

    blocks = soup.select("ul.coverList")
    print("title:", title)
    print("/subject/ count:", subject_count)
    print("coverList blocks:", len(blocks))

    total_items = 0
    for i, block in enumerate(blocks[:7]):
        header = block.find_previous("h3") or block.find_previous(["h2", "h4"])
        header_text = header.get_text(strip=True) if header else "(no header)"
        items = block.select("li")
        total_items += len(items)
        print(f"block[{i}] header={header_text} items={len(items)}")
        if items:
            li = items[0]
            link = li.find("a", href=True)
            href = link["href"] if link else ""
            style = li.get("style", "")
            cover = ""
            if "url(" in style:
                start = style.find("url(") + 4
                end = style.find(")", start)
                cover = style[start:end].strip("'\"") if end > start else ""
            title_em = li.find("em")
            title = title_em.get_text(strip=True) if title_em else (link.get_text(strip=True) if link else "")
            print("  sample href:", href)
            print("  sample title:", title)
            print("  sample cover:", cover)
    print("total li items:", total_items)

    # 额外：尝试旧结构
    old_blocks = soup.select(".calendar .week")
    print("old .calendar .week:", len(old_blocks))
    return total_items


def main() -> None:
    total = 0
    for url in ["https://bangumi.tv/calendar", "https://bgm.tv/calendar"]:
        try:
            total += debug_calendar(url)
        except Exception as exc:
            print("error:", url, exc)
    print("\n=== 完成，累计解析条目数:", total, "===")


if __name__ == "__main__":
    main()
