# 纳指/标普/黄金/港股恒生 判定逻辑对照（nasdake.top + 本地扩展）

更新时间（北京时间）：2026-03-19 16:20  
数据来源：`https://nasdake.top/api/dashboard`

## 1. 说明

本文档用于把对方网站（`nasdake.top`）的三大模块（纳指、标普、黄金）判定逻辑统一沉淀到仓库，并补充本项目自定义的“港股恒生模块”设计稿，便于后续克隆、扩展与持续校对。

逻辑来源分为两类：
- 已确认：可由 API 返回字段（`formula` / `description` / `statusColor` / `statusText` / `value` / `history`）直接确认。
- 推断：API未直接给阈值，依据 `description` 文案与当日样本状态反推。
- 设计：对方站点暂无该模块，基于港股定价逻辑、FRED 宏观因子与港股本地资金面口径做出的本地设计。

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

### 2.4 港股恒生模块（本地设计）
- `hsi_index`（恒生指数）
- `hstech_index`（恒生科技指数）
- `hk_dividend_lowvol`（恒生港股通高股息低波动指数）
- `hk_style_rotation`（港股风格轮动比值）
- `hk_dxy`（广义美元指数）
- `hk_dgs10`（10年期美债收益率）
- `hk_real_yield`（10年期实际利率）
- `hk_curve`（10Y-2Y 利差）
- `hk_fci`（美国金融条件）
- `usd_hkd`（港元兑美元汇率）
- `southbound_flow`（南向资金净流入）
- `hk_valuation`（恒生估值/股息率）

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
| `hsi_index` | 恒生指数 | 恒生指数日线 | 日变动 `>0.3%` => 风险偏好回升（success）；`<-0.3%` => 风险偏好回落（warning）；其余持平（neutral） | 设计 |
| `hstech_index` | 恒生科技指数 | 恒生科技指数日线 | 日变动 `>0.5%` => 科技风险偏好回暖（success）；`<-0.5%` => 科技承压（warning）；其余持平（neutral） | 设计 |
| `hk_dividend_lowvol` | 恒生港股通高股息低波动指数 | 东财/恒生指数公司 `HSHYLV`；必要时用跟踪 ETF 代理 | 日变动 `>0.3%` => 防御红利走强（success）；`<-0.3%` => 防御红利走弱（warning）；其余持平（neutral） | 设计 |
| `hk_style_rotation` | 港股风格轮动比值 | `恒生科技指数 / 恒生港股通高股息低波动指数` | 比值 20 日变化 `>+3%` => 市场偏进攻、成长占优（success）；`-3%~+3%` => 风格均衡（neutral）；`<-3%` => 市场转向防守（warning）；`<-8%` => 防御显著占优（danger） | 设计 |
| `hk_dxy` | 港股模块美元指数 | FRED `DTWEXBGS` | `>128` 美元偏强、压制港股估值（warning）；`120~128` 中性（neutral）；`<120` 外部汇率压力缓和（success） | 设计 |
| `hk_dgs10` | 港股模块 10Y 美债收益率 | FRED `DGS10` | `>4.5` 全球无风险利率偏高、压制估值（warning）；`4.0~4.5` 中性（neutral）；`<4.0` 估值压力缓和（success） | 设计 |
| `hk_real_yield` | 港股模块 10Y 实际利率 | FRED `DFII10` | `>2.0` 长端真实回报过高、成长板块承压（danger）；`1.0~2.0` 中性偏紧（yellow）；`<1.0` 对港股成长估值更友好（success） | 设计 |
| `hk_curve` | 港股模块 10Y-2Y 利差 | FRED `T10Y2Y` | `<0` 美国衰退预期抬升、外需与风险偏好承压（danger）；`0~0.5` 修复早期（neutral）；`>0.5` 正常扩张（success） | 设计 |
| `hk_fci` | 港股模块金融条件 | FRED `NFCI` | `>0.25` 美元流动性偏紧（warning）；`-0.25~0.25` 中性（neutral）；`<-0.25` 全球风险资产环境偏宽松（success） | 设计 |
| `usd_hkd` | 港元兑美元汇率 | FRED `DEXHKUS` 或 `EXHKUS` 换算为 USD/HKD | `>=7.84` 接近弱方兑换保证、流动性偏紧（warning）；`7.80~7.84` 常态区间（neutral）；`<7.80` 偏强侧、外部压力较轻（success） | 设计 |
| `southbound_flow` | 南向资金净流入 | 港股通净买入额（日频） | `>50` 亿港元代表南向明显加仓（success）；`0~50` 轻度流入（neutral）；`<0` 净流出（warning）；`<-50` 亿港元代表明显撤离（danger） | 设计 |
| `hk_valuation` | 恒生估值/股息率 | 恒指或恒生科技 PE/PB 分位 + 恒生股息率 | 低估值高股息（如股息率 `>4%` 或估值处历史低位）=> 安全边际改善（success）；中位附近（neutral）；高估值低股息 => 性价比下降（warning） | 设计 |

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

## 6. 港股恒生模块设计说明（本地扩展）

### 6.1 设计目标

港股模块不直接照搬纳指/标普框架，而是拆成三层：
- 市场结果层：恒生指数、恒生科技指数
- 风格对照层：恒生港股通高股息低波动指数、港股风格轮动比值
- 外部宏观层：美元、长端利率、实际利率、收益率曲线、金融条件
- 本地资金/估值层：港元汇率、南向资金、恒生估值与股息率

核心原因：
- 港股定价权高度受美元流动性、美债利率和中国相关风险偏好共同影响。
- 单用 FRED 只能覆盖“外部宏观压力”，不足以代表港股本地资金面。
- 单看指数涨跌又会把结果当原因，解释力不够。

### 6.2 建议数据源映射

FRED 主序列：
- `DTWEXBGS`：广义美元指数
- `DGS10`：10Y 美债收益率
- `DFII10`：10Y 实际利率
- `T10Y2Y`：10Y-2Y 利差
- `NFCI`：芝加哥联储金融条件指数
- `DEXHKUS` 或 `EXHKUS`：港元兑美元

港股本地补充：
- `southbound_flow`：AkShare 港股通或东财口径的南向净流入数据
- `hk_valuation`：AkShare/乐咕/百度股市通口径的恒指估值与股息率数据
- `hsi_index` / `hstech_index`：港股指数日线行情
- `hk_dividend_lowvol`：优先东财/AkShare 的 `HSHYLV` 指数行情；若运行环境无法稳定获取，则使用跟踪 ETF 作为代理序列

已验证的公开可得性：
- 恒生指数公司方法论文档已明确该指数代码为 `HSHYLV`，名称为“恒生港股通高股息低波动指数”。
- 东方财富公开行情页已存在 `HSHYLV` 页面，说明公开行情入口可访问。
- 当前本机临时验证时，直连东财接口受网络环境影响未成功返回，因此工程实现应保留 ETF 代理兜底，不应把单一数据源写死。

### 6.3 阈值设计原则

- 优先使用“方向明确、经济含义稳定”的宏观序列，避免堆砌噪音型指标。
- 阈值尽量使用市场常见分段，而不是追求极细粒度拟合。
- 对港股成长风格，`DFII10` 与 `DGS10` 的权重应高于美股顺周期框架。
- 对港股风格层，`hstech_index` 与 `hk_dividend_lowvol` 应并列展示，不设计成父子关系。
- 对港股整体市场，南向资金与港元汇率要作为独立卡片，而不是隐藏在描述里。
- `hk_valuation` 应以“低估值 + 高股息”作为 success 触发条件，避免把高股息简单理解为衰退信号。
- `hk_style_rotation` 用相对强弱比值而不是两个指数简单涨跌比较，这样更适合表达“进攻/防守”切换。

### 6.4 推荐页面分组

- 市场温度：`hsi_index`、`hstech_index`
- 风格对照：`hk_dividend_lowvol`、`hk_style_rotation`
- 外部宏观：`hk_dxy`、`hk_dgs10`、`hk_real_yield`、`hk_curve`、`hk_fci`
- 本地资金：`usd_hkd`、`southbound_flow`
- 估值锚点：`hk_valuation`

### 6.5 风险与例外

- 港股在极端风险阶段会出现“美元走强但避险股不跌反涨”的分化，页面文案要强调这是估值压力，不等于必然下跌。
- 南向资金对单日行情解释力不稳定，建议用 5 日均值或近 10 日累计净流入辅助展示。
- 港元汇率长期受联系汇率制度约束，`usd_hkd` 更适合作为“流动性压力表”，不适合当趋势交易指标。
- `hk_valuation` 若混用恒指与恒生科技口径，必须在页面标明指数范围，避免口径污染。
- `hk_dividend_lowvol` 若临时切换到 ETF 代理，页面必须标注“指数代理口径”，避免用户误以为是官方指数点位。
- `hk_style_rotation` 在红利低波数据源切换时必须同步切换分母来源，否则相对强弱会失真。

## 7. 后续维护建议

- 每次对方站点更新后，重新抓取 `api/dashboard` 校验三项：
  1. `formula` 是否变更
  2. `description` 阈值文案是否变更
  3. `statusColor/statusText` 是否与本地一致
- 建议在本项目新增一个“校对脚本”，自动对比本地 API 与对方 API 的 `id/value/statusColor` 差异。
- 对港股恒生模块，建议额外维护三项：
  1. FRED 序列与港股本地数据源的刷新频率映射
  2. 南向资金与估值数据的备用抓取源
  3. 恒指/恒生科技阈值在大行情切换后的复核记录
