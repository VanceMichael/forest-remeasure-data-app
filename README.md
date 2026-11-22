# 林地变化估计与有限补测的报告认证

业务资料均为合成记录。表头字段及跨表引用见 `fixtures/format.json`。

## 数据说明

cells 记录各小班面积、抽样层和历年边界，未纳入写作 `-`。争议小班的边界以确认附在 zone_v2，revision_known 是复核得知时间。共有比较按同时入区的面积；全期现况可包括新入区。plots 的 design_weight 是抽样设计权重，response 为 ok 或 inaccessible；paired 仍须核对两年是否确有可配记录。validation-plots 与正式估计样方不同，提供分类器类别检查。
情景中的认证宽度按比例点区间宽度计。field-options 的总工时包含共同路线到场时间，effort 的 reserved_cells 是确定复测地块，取消其安排需另审。路线不含的地块不能当作完成复测。

CSV 使用 UTF-8、逗号分隔，无引号与内嵌换行。未提供的字段是空字符串，作为关系值的 `-` 表示不适用。多值字段用竖线分隔，数值和日期单位见业务约定。

## 资料检查

使用 Node.js 22.23.4，依赖仅为 Node.js 标准库。运行 `npm ci --ignore-scripts --offline` 准备工作区。

运行 `npm run check:materials` 检查合成交接资料的字段与记录引用。运行 `npm test` 检查交接资料的读取和校验。
