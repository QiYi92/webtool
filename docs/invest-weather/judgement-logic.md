# 纳指/标普/黄金 判定逻辑对照（nasdake.top）

更新时间（北京时间）：2026-03-19 16:20  
数据来源：`https://nasdake.top/api/dashboard`

## 1. 说明

本文档用于把对方网站（`nasdake.top`）的三大模块（纳指、标普、黄金）判定逻辑统一沉淀到仓库，便于后续克隆与持续校对。

逻辑来源分为两类：
- 已确认：可由 API 返回字段（`formula` / `description` / `statusColor` / `statusText` / `value` / `history`）直接确认。
- 推断：API未直接给阈值，依据 `description` 文案与当日样本状态反推。

## 2. 模块卡片清单（去重）

### 2.1 纳斯达克模块（含市场卡 + 三梯队）
- `nasdaq_index`（纳斯达克指数）
- `nasdaq100_index`（纳斯达克100）
- `dgs10`（10年期美债收益率）
- `fedfunds`（联邦基金利率）
- `tech_strength`（科技相对强度）
- `vxn`（纳指波动率）
- `nasdaq_real_yield`（实际利率-纳指压力表）
- `hyd`（高收益债利差）
- `dxy`（广义美元指数）
- `stress`（金融压力指数）
- `curve`（10Y-2Y利差）
- `margin`（融资余额增速）
- `buffett`（市场估值指标）
- `cpi`（CPI同比）
- `indpro`（工业生产同比）

### 2.2 标普500模块（可见与共享）
- `sp500_index`（标普500指数）
- `unrate`（失业率）
- `vix`（标普波动率）
- 以及与纳指共享的宏观卡：`dgs10`、`fedfunds`、`hyd`、`dxy`、`stress`、`curve`、`cpi`、`indpro`、`buffett`（页面分组可能不同）

### 2.3 黄金模块
- `gold_index`（黄金趋势指数）
- `silver_index`（白银趋势指数）
- `real_yield`（10年期实际利率）
- `breakeven`（10年期通胀预期）
- `fed_assets`（美联储资产负债表）
- `nonfarm`（非农就业变化）
- `gold_dxy`（美元指数）
- `gold_unrate`（失业率）

## 3. 判定逻辑总表

| 指标ID | 指标名 | 主要序列/口径 | 判定逻辑 | 证据级别 |
|---|---|---|---|---|
| `nasdaq_index` | 纳斯达克指数 | FRED `NASDAQCOM` | 日变动<0 => 下跌（warning）；>0 => 上涨（success）；≈0持平（neutral） | 推断（由状态与日变动一致性） |
| `nasdaq100_index` | 纳斯达克100 | FRED `NASDAQ100` | 同上 | 推断 |
| `sp500_index` | 标普500指数 | FRED `SP500` | 同上 | 推断 |
| `dgs10` | 10Y美债收益率 | FRED `DGS10` | `>4.5` 压估值（warning）；`4.0~4.5` 中性（neutral）；`<4.0` 偏宽松（success） | 已确认（description） |
| `fedfunds` | 联邦基金利率 | FRED `FEDFUNDS` | 利率高位偏紧、低位偏松；当前 `3.64` 为“利率维持（neutral）” | 部分确认（文案+样本） |
| `tech_strength` | 科技相对强度 | `NASDAQCOM / SP500` | 比率上升=科技领涨（偏success）；下降=科技跑输（warning） | 已确认（formula+description） |
| `vxn` | 纳指波动率 | 优先 `VXNCLS`，缺失用 `VIXCLS` | `<15` 过热乐观；`15~25` 正常（neutral）；`>30` 恐慌（danger） | 已确认 |
| `hyd` | 高收益债利差 | FRED `BAMLH0A0HYM2` | `<3.5` 健康（success）；`4~5` 警戒（warning）；`>5` 危险（danger） | 已确认 |
| `dxy` | 广义美元指数 | FRED `DTWEXBGS` | 文案强调方向影响EPS；站点状态通常给“汇率中性（success）” | 部分确认 |
| `stress` | 金融压力指数 | FRED `STLFSI4` | `>0` 金融偏紧（warning）；`<0` 宽松（success） | 已确认 |
| `curve` | 10Y-2Y利差 | FRED `T10Y2Y` | `<0` 倒挂衰退预警（danger）；`>=0` 正常（通常success） | 已确认 |
| `margin` | 融资余额增速 | `BOGZ1FL663067003Q` 同比 | 同比增速高（特别`>30%`）=杠杆过热；负增长=去杠杆 | 已确认 |
| `buffett` | 市场估值指标 | `SP500/GDP` 趋势追踪 | 指标上行=估值扩张（warning）；下行=收缩（success） | 已确认 |
| `cpi` | CPI同比 | `CPIAUCSL` 同比 | `>3%` 鹰派压力；`<2%` 鸽派空间；当前 `2.43` 显示“通胀受控（success）” | 已确认 |
| `indpro` | 工业生产同比 | `INDPRO` 同比 | `<0` 收缩风险；`>=0` 扩张（success） | 已确认 |
| `unrate` | 失业率 | FRED `UNRATE` | 失业率上行=就业恶化（warning）；低失业接近充分就业 | 部分确认 |
| `vix` | 标普波动率 | FRED `VIXCLS` | 12~20常态；<12过度自满；>30恐慌 | 已确认 |
| `nasdaq_real_yield` | 实际利率（纳指压力表） | FRED `DFII10` | `>2%` 强压估值；`1~2%` 中性偏紧（yellow）；`<1%` 成长估值有利；<0最有利 | 已确认（description+样本色） |
| `real_yield` | 10Y实际利率（黄金） | FRED `DFII10` | 对黄金负相关：高实际利率利空黄金，低/负利率利好黄金 | 已确认 |
| `breakeven` | 10Y通胀预期 | FRED `T10YIE` | `>2.5%` 通胀预期升温（偏利多黄金）；`<2%` 通缩预期（利空黄金） | 已确认 |
| `fed_assets` | 美联储总资产 | FRED `WALCL` | 扩表=流动性释放（偏利多黄金）；缩表反之 | 已确认 |
| `nonfarm` | 非农就业变化 | FRED `PAYEMS` 月环比 | `>200k` 就业强劲；`<100k` 放缓。站点在负值时给 `danger`（宏观风险语义） | 已确认（阈值）+语义说明 |
| `gold_dxy` | 黄金模块美元指数 | FRED `DTWEXBGS` | 与金价常负相关；危机阶段可同涨 | 已确认 |
| `gold_unrate` | 黄金模块失业率 | FRED `UNRATE` | 失业率趋势上升常对应衰退/降息预期升温（黄金逻辑偏多） | 已确认 |
| `gold_index` | 黄金趋势指数 | NASDAQ Commodity Gold Index | 指数下行为“黄金走弱（warning）”，上行相反 | 推断 |
| `silver_index` | 白银趋势指数 | NASDAQ Commodity Silver Index | 指数下行为“白银走弱（warning）”，上行相反 | 推断 |

## 4. 状态色语义（对方站点）

- `success`：环境偏有利/健康/宽松
- `neutral`：中性/常态区间
- `warning`：偏紧、走弱、压力上升
- `danger`：高风险/衰退或恐慌级信号
- `yellow`：介于 neutral 与 warning 的“中性偏紧”（对方用于 `nasdaq_real_yield`）

### 4.1 页面显色依据（已确认）

对方前端卡片存在两套颜色逻辑：
- 状态徽章颜色：按 `statusColor` 渲染。
- 主数值/折线颜色：也按 `statusColor` 渲染（不是按板块固定色）。

映射关系：
- `success` -> 绿色
- `warning` -> 黄色/琥珀色
- `yellow` -> 黄色/琥珀色
- `danger` -> 红色
- `neutral` -> 白色/浅灰（深色主题下接近白）

“日内变动”颜色是单独规则（与 `statusColor` 无关）：
- `secondaryValue > 0` -> 绿色
- `secondaryValue < 0` -> 红色
- `secondaryValue = 0/无` -> 中性色

## 5. 已落地到本项目的对齐重点

当前你项目 `frontend/app/api/invest-weather/nasdaq/route.ts` 已对齐的关键口径：
- 指数卡下跌/上涨状态逻辑（不再默认持平）
- `vxn` 使用 `VXNCLS`（缺失再回退）
- `margin` 使用 `BOGZ1FL663067003Q` 季度同比
- `buffett` 趋势口径与对方数值区间对齐
- `cpi/indpro` 同比按“同月去年”计算
- 支持 `yellow` 状态色

## 6. 后续维护建议

- 每次对方站点更新后，重新抓取 `api/dashboard` 校验三项：
  1. `formula` 是否变更
  2. `description` 阈值文案是否变更
  3. `statusColor/statusText` 是否与本地一致
- 建议在本项目新增一个“校对脚本”，自动对比本地 API 与对方 API 的 `id/value/statusColor` 差异。
