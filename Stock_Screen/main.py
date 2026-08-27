from __future__ import annotations

import argparse
from pathlib import Path

from screen_bowl_shape import DEFAULT_CONFIG_PATH, SLEEP_SECONDS, run_screening


PROJECT_ROOT = Path(__file__).resolve().parent
CONFIG_DIR = PROJECT_ROOT / "configs"

# ==================== 直接运行配置区 ====================
# 在 VSCode 右上角点击运行时，会默认使用这里指定的配置。
# 可选配置：
# - "default_bowl"：默认碗型策略
# - "default_bowl_v2"：只筛右碗壁尚未形成或刚形成、K 线仍在碗底附近的策略
ACTIVE_CONFIG_NAME = "default_bowl_v2"

# 如果想直接写完整路径，可以填写这个变量；不需要时保持 None。
# 示例："configs/default_bowl.json"
ACTIVE_CONFIG_PATH = None

# 是否打开对应板块识别：True 表示允许纳入筛选，False 表示排除。
ENABLE_STAR_MARKET = False
ENABLE_CHINEXT_MARKET = False

# 是否启用形态和成交量过滤。
ENABLE_BOWL_FILTER = True
ENABLE_VOLUME_FILTER = True
# ======================================================


def list_config_files() -> list[Path]:
    """列出 configs 目录下可用的 JSON 筛选配置。"""
    if not CONFIG_DIR.exists():
        return []
    return sorted(CONFIG_DIR.glob("*.json"))


def resolve_config_path(config: str | None, config_name: str | None) -> str | None:
    """根据配置路径或配置名称解析最终使用的配置文件。"""
    if config:
        path = Path(config)
        return str(path if path.is_absolute() else PROJECT_ROOT / path)

    if config_name:
        name = config_name.strip()
        filename = name if name.endswith(".json") else f"{name}.json"
        return str(CONFIG_DIR / filename)

    if ACTIVE_CONFIG_PATH:
        path = Path(ACTIVE_CONFIG_PATH)
        return str(path if path.is_absolute() else PROJECT_ROOT / path)

    if ACTIVE_CONFIG_NAME:
        filename = ACTIVE_CONFIG_NAME if ACTIVE_CONFIG_NAME.endswith(".json") else f"{ACTIVE_CONFIG_NAME}.json"
        return str(CONFIG_DIR / filename)

    return str(PROJECT_ROOT / DEFAULT_CONFIG_PATH)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="A 股股票筛选一键启动入口")
    parser.add_argument(
        "--config",
        default=None,
        help="直接指定配置文件路径，例如 configs/default_bowl_v2.json",
    )
    parser.add_argument(
        "--config-name",
        default=None,
        help="指定 configs 目录下的配置名称，例如 default_bowl_v2",
    )
    parser.add_argument(
        "--list-configs",
        action="store_true",
        help="列出 configs 目录下可用配置后退出",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="输出 Excel 路径；不传则保存到 data 目录并自动带时间戳",
    )
    parser.add_argument(
        "--symbols",
        nargs="*",
        help="只扫描指定股票代码，例如: --symbols 000001 600519",
    )
    parser.add_argument(
        "--min-market-value",
        type=float,
        default=None,
        help="临时覆盖配置中的最小总市值，单位元",
    )
    parser.add_argument(
        "--sector-keyword",
        default=None,
        help="临时覆盖配置中的板块/名称/概念关键词",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=SLEEP_SECONDS,
        help="每只股票请求后的暂停秒数",
    )
    parser.add_argument(
        "--enable-bowl-filter",
        action="store_true",
        help="临时启用碗型过滤",
    )
    parser.add_argument(
        "--disable-bowl-filter",
        action="store_true",
        help="临时关闭碗型过滤",
    )
    parser.add_argument(
        "--use-proxy",
        action="store_true",
        help="使用当前终端代理；默认关闭代理以减少行情接口连接失败",
    )
    return parser.parse_args()


def build_direct_run_overrides() -> dict:
    """根据 main.py 顶部开关生成本次运行的配置覆盖。"""
    excluded_prefixes: list[str] = []
    if not ENABLE_CHINEXT_MARKET:
        excluded_prefixes.extend(["300", "301", "302"])
    if not ENABLE_STAR_MARKET:
        excluded_prefixes.extend(["688", "689"])

    return {
        "basic": {
            "excluded_board_prefixes": excluded_prefixes,
            "enable_bowl_filter": ENABLE_BOWL_FILTER,
            "enable_volume_filter": ENABLE_VOLUME_FILTER,
        }
    }


def main() -> None:
    args = parse_args()

    if args.list_configs:
        configs = list_config_files()
        if not configs:
            print("未找到配置文件")
            return
        for path in configs:
            print(path)
        return

    config_path = resolve_config_path(args.config, args.config_name)
    sector_keyword = args.sector_keyword.strip() if args.sector_keyword else None
    enable_bowl_filter: bool | None = True if args.enable_bowl_filter else None
    if args.disable_bowl_filter:
        enable_bowl_filter = False

    run_screening(
        config_path=config_path,
        config_overrides=build_direct_run_overrides(),
        output=args.output,
        symbols=args.symbols,
        min_market_value=args.min_market_value,
        sector_keyword=sector_keyword,
        sleep_seconds=args.sleep,
        enable_bowl_filter=enable_bowl_filter,
        use_proxy=args.use_proxy,
    )


if __name__ == "__main__":
    main()
