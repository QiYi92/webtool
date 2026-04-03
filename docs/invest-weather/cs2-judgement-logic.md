# CS2 饰品气象站判定逻辑对照（SteamDT + 本地扩展）

更新时间（北京时间）：2026-04-03 11:01  
数据来源：
- `https://api.steamdt.com/index/statistics/v1/summary`
- `https://api.steamdt.com/index/item-block/v1/summary`
- `https://api.steamdt.com/user/item/block/v1/relation`
- `https://api.steamdt.com/user/item/block/v1/skin-list`
- `https://api.steamdt.com/user/item/block/v1/trend`（部分环境会触发风控）

## 1. 说明

本文档用于把 CS2 饰品模块的判定逻辑统一沉淀到仓库，口径来源分为三类：
- 已确认：可由你项目代码与 SteamDT 返回字段直接确认。
- 推断：API 未给固定阈值，但可以从市场结构与字段语义稳定推导。
- 设计：你项目尚未上线、但基于 CS2 实际交易结构可直接扩展的指标方案。

对照目标：
- 保证页面状态文案、颜色、阈值与后端逻辑一致。
- 区分“平台原始字段”和“本地解释层”避免后续误改。
- 给后续扩展（供需冲击、轮动、事件驱动）提供统一框架。

## 2. 模块清单（当前已落地）

### 2.1 市场总览卡片（`sections.market.cards`）
- `broad_market_index`（大盘指数）
- `trade_turnover`（饰品成交额）
- `trade_volume`（饰品成交量）
- `add_valuation`（饰品新增额）
- `add_volume`（饰品新增量）
- `survive_num`（饰品存世量）
- `holders_num`（持有人数）

### 2.2 板块排行（`boards`）
- `hot`（热门板块）
- `itemTypeLevel1`（一级板块）
- `itemTypeLevel2`（二级板块）
- `itemTypeLevel3`（三级板块）

### 2.3 板块详情弹窗（`/api/invest-weather/cs2/block-detail`）
- 价格线：`relation.trendList` 主用，`trend.trendList` 可用时优先
- 成分榜：`skin-list` 上涨榜（`DESC`）+ 下跌榜（`ASC`）
- 统计项：当前值、昨日值、最高、最低、涨跌值、涨跌幅

## 3. 判定逻辑总表（当前实现）

| 指标ID | 指标名 | 主要序列/口径 | 判定逻辑 | 证据级别 |
|---|---|---|---|---|
| `broad_market_index` | 大盘指数 | `summary.broadMarketIndex` + `diffYesterdayRatio` | `secondaryValue > 0` => `success(市场走强)`；`<0` => `warning(市场走弱)`；`=0` => `neutral(市场横盘)` | 已确认 |
| `trade_turnover` | 饰品成交额 | `todayStatistics.turnover` + `tradeAmountRatio` | `>= +5%` => `success(成交放量)`；`<= -5%` => `warning(成交回落)`；其他 `neutral` | 已确认 |
| `trade_volume` | 饰品成交量 | `todayStatistics.tradeNum` + `tradeVolumeRatio` | `>= +5%` => `success`；`<= -5%` => `warning`；其他 `neutral` | 已确认 |
| `add_valuation` | 饰品新增额 | `todayStatistics.addValuation` + `addAmountRatio` | `>= +10%` => `danger(新增活跃)`；`<= -10%` => `warning(新增回落)`；其他 `neutral` | 已确认 |
| `add_volume` | 饰品新增量 | `todayStatistics.addNum` + `addNumRatio` | `>= +10%` => `danger`；`<= -10%` => `warning`；其他 `neutral` | 已确认 |
| `survive_num` | 饰品存世量 | `summary.surviveNum` | 固定 `neutral(库存扩张中)`，当前仅做规模展示不做方向判定 | 已确认 |
| `holders_num` | 持有人数 | `summary.holdersNum` | 固定 `neutral(持有人规模)`，当前仅做广度展示不做方向判定 | 已确认 |
| `boards.*.defaultList` | 板块默认排行 | `item-block summary` | 直接展示平台排序，不改写排序逻辑 | 已确认 |
| `boards.*.topList` | 板块上涨排行 | `item-block summary` | 直接展示平台上涨榜 | 已确认 |
| `boards.*.bottomList` | 板块下跌排行 | `item-block summary` | 直接展示平台下跌榜 | 已确认 |

## 4. 状态色语义（CS2 页面）

注意：CS2 页面颜色语义与美股/宏观页不同，采用“涨红跌绿”的本地交易视觉习惯。

- `success`：玫红（偏多/走强）
- `warning`：琥珀（偏弱/回落）
- `danger`：翠绿（在 CS2 语境下用于“新增激增”等高波动提示，不等于利空）
- `neutral`：灰色（中性）
- `yellow`：与 `warning` 同色（当前 CS2 卡片未单独使用）

## 5. CS2 市场实际情况下的解读口径

以下为“解释层”，不改变当前代码判定：

- `成交额/成交量` 是需求活跃度代理，但会被“高价单品波动”放大，建议和 `add_*` 联合看。
- `新增额/新增量` 在 CS2 更接近供给冲击（开箱、活动、回流），短期可能压价格，故当前用 `danger` 标注“活跃但波动高”。
- `存世量` 长期上行是常态，单日变化解释力弱，更适合做慢变量。
- `持有人数` 反映参与广度，但受统计口径变化影响，短线信号弱于成交与板块轮动。
- 板块（`hot/level1/2/3`）更接近“风格与主题轮动”，对短期交易更有解释力。

## 6. 实时接口现状校验（2026-04-03）

- `summary` 可稳定返回：`broadMarketIndex`、`todayStatistics`、`surviveNum`、`holdersNum`。
- `item-block summary` 当前稳定返回四级键：`hot`、`itemTypeLevel1`、`itemTypeLevel2`、`itemTypeLevel3`。
- `relation` 与 `skin-list` 可稳定返回（用于板块线与成分榜）。
- `trend` 在当前环境返回 `errorCode=108` 风控错误，与你项目现状一致，因此页面默认不强依赖在售数量线。

## 7. 已落地到本项目的对齐重点

当前 `frontend/app/api/invest-weather/cs2/route.ts` 与 `block-detail/route.ts` 已实现：
- 2 分钟文件缓存（`.cache/invest-weather/cs2.json`），支持 stale 返回 + 后台刷新。
- `fetch` 失败自动回退 `curl`，降低 SteamDT 侧偶发连接失败影响。
- 板块列表默认挂载 `relation` 趋势线（热门 + 一级优先增强）。
- 板块详情支持 `relation`/`skin-list` 双向榜单，`trend` 不可用时自动降级。
- 成分榜固定 Top 10，避免弹窗超重和请求耗时失控。

## 8. 本地可扩展指标（设计稿）

| 指标ID | 指标名 | 建议公式 | 状态建议 | 证据级别 |
|---|---|---|---|---|
| `supply_pressure` | 供给压力比 | `add_volume / trade_volume` | `>0.35` warning，`0.15~0.35` neutral，`<0.15` success | 设计 |
| `capital_efficiency` | 资金效率 | `trade_turnover / trade_volume`（均价代理） | 结合 7 日均线做强弱切换 | 设计 |
| `breadth_momentum` | 参与广度动量 | `holders_num` 的 7 日变化率 | 持续转正 success，持续转负 warning | 设计 |
| `rotation_dispersion` | 轮动离散度 | `topList 均值 - bottomList 均值` | 离散度高=主题行情；低=普跌普涨 | 设计 |
| `event_risk_flag` | 事件冲击标记 | 新箱/大行动/major 贴纸窗口 | 仅做标签，不直接着色 | 设计 |

## 9. 后续维护建议

- 每次 SteamDT 字段变更后，优先校验三项：
  1. `todayStatistics.*Ratio` 字段是否仍为百分比口径。
  2. `item-block` 四层 key 是否增删改。
  3. `trend` 是否恢复稳定可用（决定是否重新启用在售数量线）。
- 建议新增对账脚本：定时比较“本地缓存 vs 实时接口”的 `value/statusColor` 漂移。
- 若上线扩展指标，先用 30 天回放做阈值分位，再写死到判定函数，避免拍脑袋阈值。
