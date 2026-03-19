from __future__ import annotations

import html
import random
import threading
import time
import uuid
from dataclasses import dataclass
from urllib.parse import quote

MAX_LOGIN_FAILURES = 5
LOCK_SECONDS = 10 * 60
CAPTCHA_TTL_SECONDS = 5 * 60


@dataclass
class _FailureState:
    count: int = 0
    lock_until: float = 0.0


@dataclass
class _CaptchaState:
    answer: str
    expire_at: float


_LOCK = threading.Lock()
_FAILURES: dict[str, _FailureState] = {}
_CAPTCHAS: dict[str, _CaptchaState] = {}


def _now() -> float:
    return time.time()


def _cleanup() -> None:
    now = _now()
    expired_failure_keys = [k for k, v in _FAILURES.items() if v.count <= 0 and v.lock_until <= now]
    for key in expired_failure_keys:
        _FAILURES.pop(key, None)

    expired_captcha_keys = [k for k, v in _CAPTCHAS.items() if v.expire_at <= now]
    for key in expired_captcha_keys:
        _CAPTCHAS.pop(key, None)


def normalize_identifier(identifier: str) -> str:
    return identifier.strip().lower()


def create_captcha() -> tuple[str, str, int]:
    left = random.randint(1, 20)
    right = random.randint(1, 20)
    if random.choice([True, False]):
        expression = f"{left} + {right} = ?"
        answer = str(left + right)
    else:
        high = max(left, right)
        low = min(left, right)
        expression = f"{high} - {low} = ?"
        answer = str(high - low)

    captcha_id = uuid.uuid4().hex
    expire_at = _now() + CAPTCHA_TTL_SECONDS

    svg = _render_svg(expression)
    data_uri = f"data:image/svg+xml;utf8,{quote(svg)}"

    with _LOCK:
        _cleanup()
        _CAPTCHAS[captcha_id] = _CaptchaState(answer=answer, expire_at=expire_at)

    return captcha_id, data_uri, CAPTCHA_TTL_SECONDS


def verify_captcha(captcha_id: str, captcha_answer: str) -> bool:
    answer = captcha_answer.strip()
    with _LOCK:
        _cleanup()
        item = _CAPTCHAS.pop(captcha_id, None)
        if not item:
            return False
        if item.expire_at <= _now():
            return False
        return answer == item.answer


def get_lock_remaining_seconds(identifier: str) -> int:
    key = normalize_identifier(identifier)
    with _LOCK:
        _cleanup()
        state = _FAILURES.get(key)
        if not state:
            return 0
        remaining = int(state.lock_until - _now())
        return remaining if remaining > 0 else 0


def register_login_failure(identifier: str) -> int:
    key = normalize_identifier(identifier)
    now = _now()
    with _LOCK:
        _cleanup()
        state = _FAILURES.get(key)
        if not state:
            state = _FailureState()
            _FAILURES[key] = state

        if state.lock_until > now:
            return int(state.lock_until - now)

        state.count += 1
        if state.count >= MAX_LOGIN_FAILURES:
            state.count = 0
            state.lock_until = now + LOCK_SECONDS
            return LOCK_SECONDS

        state.lock_until = 0.0
        return 0


def clear_login_failures(identifier: str) -> None:
    key = normalize_identifier(identifier)
    with _LOCK:
        _FAILURES.pop(key, None)


def _render_svg(expression: str) -> str:
    safe_expression = html.escape(expression)
    palette = random.choice(
        [
            {"bg1": "#F8FAFC", "bg2": "#E0F2FE", "accent": "#0EA5E9", "text": "#0F172A"},
            {"bg1": "#FFF7ED", "bg2": "#FEE2E2", "accent": "#F97316", "text": "#111827"},
            {"bg1": "#ECFDF5", "bg2": "#DCFCE7", "accent": "#22C55E", "text": "#1F2937"},
            {"bg1": "#F5F3FF", "bg2": "#E0E7FF", "accent": "#6366F1", "text": "#1E1B4B"},
        ]
    )

    line1_y = random.randint(14, 58)
    line2_y = random.randint(14, 58)
    dots = []
    for _ in range(10):
        cx = random.randint(10, 210)
        cy = random.randint(10, 62)
        r = random.randint(1, 2)
        dots.append(
            f"<circle cx='{cx}' cy='{cy}' r='{r}' fill='{palette['accent']}' opacity='0.22'/>"
        )

    return (
        "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='72' viewBox='0 0 220 72'>"
        "<defs>"
        "<filter id='softShadow' x='-20%' y='-20%' width='140%' height='140%'>"
        "<feDropShadow dx='0' dy='1' stdDeviation='1' flood-color='#94A3B8' flood-opacity='0.35'/>"
        "</filter>"
        "<pattern id='grid' width='12' height='12' patternUnits='userSpaceOnUse'>"
        "<path d='M12 0H0V12' fill='none' stroke='#CBD5E1' stroke-opacity='0.18' stroke-width='1'/>"
        "</pattern>"
        f"<linearGradient id='bgGrad' x1='0%' y1='0%' x2='100%' y2='100%'>"
        f"<stop offset='0%' stop-color='{palette['bg1']}'/>"
        f"<stop offset='100%' stop-color='{palette['bg2']}'/>"
        "</linearGradient>"
        "</defs>"
        "<rect x='1' y='1' width='218' height='70' rx='12' fill='url(#bgGrad)' stroke='#CBD5E1'/>"
        "<rect x='6' y='6' width='208' height='60' rx='10' fill='url(#grid)' opacity='0.9'/>"
        f"<path d='M10 {line1_y} C 60 {line1_y - 8}, 150 {line1_y + 8}, 210 {line1_y - 3}' stroke='{palette['accent']}' stroke-width='1.2' opacity='0.38' fill='none'/>"
        f"<path d='M10 {line2_y} C 70 {line2_y + 9}, 140 {line2_y - 10}, 210 {line2_y + 2}' stroke='{palette['accent']}' stroke-width='1.1' opacity='0.28' fill='none'/>"
        + "".join(dots)
        + f"<text x='110' y='46' text-anchor='middle' font-family='ui-monospace, Menlo, Monaco, Consolas, monospace' font-size='30' font-weight='700' letter-spacing='1.5' fill='{palette['text']}' filter='url(#softShadow)'>{safe_expression}</text>"
        "</svg>"
    )
