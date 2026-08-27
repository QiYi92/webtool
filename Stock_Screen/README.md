# Stock_Screen

工具站“投资走势预测”使用的 A 股策略模块。该模块随 `galileocat-webtool` 仓库发布，运行时由 Docker Compose 只读挂载到 backend 容器的 `/opt/stock_screen`。

## 内容

- `screen_bowl_shape.py`：股票筛选逻辑。
- `configs/*.json`：可在工具站中选择的策略配置。
- `excel_exporter.py`：原始 Excel 报告导出。
- `test_*.py`：策略模块单元测试。

## 维护约束

- 新增策略时，在 `configs/` 新增合法文件名的 JSON 文件；工具站会自动发现它。
- 不要提交 `data/`、缓存、虚拟环境或真实运行报告。
- backend 容器使用 `/opt/stock_screen`，本地直接运行 backend 时默认解析仓库内的 `Stock_Screen/`。不要再依赖或创建 `Stock_Screen_demo` 同级目录。
