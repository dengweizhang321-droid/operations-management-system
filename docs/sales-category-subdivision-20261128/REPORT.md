# 品类细分：补充净水器、开水器（一/二/三级）交付报告

状态：**候选，已提交到分支 `codex/water-purifier-boiler-subdivision-20261128`，未合并、未发布**。沿用直饮机方案（[20261126 报告](../sales-category-subdivision-20261126/REPORT.md)）。

## 映射来源

《净水器&开水器分类.xlsx》SHA-256 `d637c5bf9edf724bfc7d9fc37e7c94bfab485582c4fe1f5fd907a5c4dc270bab`；用本目录 `generate_purifier_boiler_maps.py` 重新生成（表格内嵌约 340 MB 图片，脚本按 zip 流式读取工作表 XML）。

| 一级类目 | 工作表 | 条目 | 细分 | 层级 |
| --- | --- | --- | --- | --- |
| 净水器 | 净水器 | 80 | 7 | 二级（超滤净水器、RO净水器、纯水机、工业RO净水器、售水机、超纯水机、配件） |
| 开水器 | 羽骏开水器 + 开水器 | 472 | 67 个三级，归属 7 个二级（水尺、数显、数控、指针、步进式、一开一常温开水器，吧台机） | 二级 + 三级 |

- 压力桶 4 行表格一级为“配件”，归入“净水器”一级下的细分“配件”。
- “水盘款开水器”“水盘款开水器（发泡）”在表格中同时挂在“水尺开水器”和“数显开水器”下，为保证每个三级只属一个二级，名称后缀二级：如“水盘款开水器（水尺开水器）”。
- 没有货品编码也没有名称、或没有二级类目的行（如“1吨两罐标准款全配”“1吨无菌水箱”）未收录。
- 三个映射之间、与直饮机映射之间货品编码无冲突。
- 覆盖的吉客云分类（用于“未归类”提示）：净水器 = 净水器、售水机；开水器 = 开水器、数控开水器、数显开水器、步进式开水器、水尺开水器。

## 变更

- Django：`subdivision_maps/water_purifier.py`、`water_boiler.py`（生成）；`subdivisions.py` 注册两个大类目，细分带 `parent`（二级类目），新增 `parent_of/has_levels/parent_labels`；`subdivision_analysis.py` 新增 `level=leaf|parent`（按二级时三级归并到二级）；`subdivision_mapping.py` 行带 `parentSubdivision`，细分筛选可按二级；`views.py` 透传 `level`。无迁移、无数据写入。
- 前端：系统设置 › 货品细分映射：列改为一级/二级/三级类目；“细分名称”筛选和行内编辑改为可搜索的下拉直接选择（显示“二级 › 三级”，可按二级整体筛选）；映射来源列出全部表格。销售分析 › 品类分析 › 品类细分：开水器显示“按二级 / 按三级”切换，按二级时不显示新增/删除细分入口。
- 文档：`README.md`、`docs/规范/业务口径.md` 各更新一句。

## 必需检查

| 检查 | 结果 |
| --- | --- |
| `python -m py_compile`（改动 Python 文件） | 通过 |
| `manage.py check` | no issues |
| `npx tsc --noEmit`（改动文件过滤） | 0 错误 |
| `npx eslint`（改动 TSX） | 无输出 |
| `npm run check:backend-boundary` | 退出码 0 |
| `npm run build` | 退出码 0 |

未做功能验证；范围 Django + Worker，合并与上线需分别授权。
