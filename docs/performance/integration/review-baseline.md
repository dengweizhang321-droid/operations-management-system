# 集成验证中的原测试与运行环境边界

日期：2026-10-06（Asia/Shanghai）。复核 HEAD `8fcad768a5cbb5dd1376afea65300eb05cfddb4b`，共同源码基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`。本复核只运行标准库的纯 XLSX 构造/ZIP 比较脚本，没有导入 Django 或 finance 业务，没有启动数据库、构建或运行完整测试集，也没有修改原测试或 fixture。

## 1. Finance golden 字节断言：具有精确基线复现资格

原测试是 `backend/finance/tests/test_workbook_bytes_v2.py:104-106` 的 `WorkbookBytesTests.test_cross_runtime_golden_fixture_has_exact_source_and_evidence_hash`。它先断言固定 XLSX 整包字节等于 `_xlsx()`，随后才验证固定 SHA 与业务解析证据。本次复现范围是第一项字节断言及 ZIP 内容，未执行后续财务业务解析。

独立脚本 [verify-golden-baseline.py](verify-golden-baseline.py) 分别从 `git show bab42d8c:...` 读取基线源文件和本树读取当前源文件；仅抽取 `_cell`、`_xlsx` 两个 AST FunctionDef 与 NS/REL 两个字面量常量执行。未导入原测试模块、Django、数据库 settings 或财务业务代码。脚本同时核验：

- 基线 test Git blob 与当前 HEAD blob 完全相同；本地文件除 CRLF/LF 规范化外一致。
- 两版被执行 helper AST 相同。
- 固定 fixture 在基线、HEAD 与工作区中逐字节相同，长 1665 字节，SHA256 为 `098c31d5f64b19347baea3b33b5daa059cc7cd7aadfde8466170943a87680f54`。
- 同一解释器内，基线与当前 helper 生成字节始终完全相同。

| 实际运行时 | 基线 / 当前生成长度 | 生成 SHA256 | 与固定 fixture |
| --- | ---: | --- | --- |
| Python 3.14.6；zlib 1.3.1.zlib-ng，ZLIBNG_VERSION 2.2.4 | 1674 / 1674 | `72fb9179657daff6e42e5def9a5e603e1b80211f65ead65f78dce3481269c0ba` | 两版都不相等 |
| bundled Python 3.12.14；zlib 1.3.2 | 1665 / 1665 | `098c31d5f64b19347baea3b33b5daa059cc7cd7aadfde8466170943a87680f54` | 两版都相等 |

Python 3.14 的 5 个 ZIP 成员压缩字节都与 fixture 不同，但每个成员解压后的完整 XML 字节、CRC、日期、压缩类型、创建/解压版本、属性、标志、extra 与 comment 均一致；Python 3.12 整包即一致。差异被定位在压缩表示及其长度/偏移连带变化。本次没有在同一 Python 上替换压缩库，因此不把 zlib-ng 的存在推断为唯一底层根因；也不推断财务口径或数据错误。

这是**同一运行时基线与候选都触发原首项断言失败**的独立证据，可以将该项排除为五项性能组合引入的源码回归。它不是对原测试设计的修复、不是完整 finance 测试通过，也不授权改 fixture 或放宽原 SHA 合同。

机器证据：

- [golden-python314.json](baseline-evidence/golden-python314.json)
- [golden-bundled-python312.json](baseline-evidence/golden-bundled-python312.json)

两个记录均有源码/fixture 摘要、逐成员未压缩与压缩摘要、运行时版本和 `djangoImported=false` / `financeImported=false`。

复现命令（仅写本复核证据目录）：

```powershell
& 'C:\Users\86137\AppData\Local\Programs\Python\Python314\python.exe' -B docs/performance/integration/verify-golden-baseline.py --output docs/performance/integration/baseline-evidence/golden-python314.json
& 'C:\Users\86137\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -B docs/performance/integration/verify-golden-baseline.py --output docs/performance/integration/baseline-evidence/golden-bundled-python312.json
```

## 2. Finance reserved edge：裁剪 settings 与测试范围不匹配

只读原失败日志 `.runtime/sales-performance-pg-af4f4dcb56a65bf2/tests.log`：187 项结尾为 **failures=3, errors=3**。其中 3 个 error 和 2 个 fail 是 `finance.tests.test_netshop_reserved_edge`；剩余 1 个 fail 是上面的 golden。

调用栈清楚显示 `finance/netshop_reads.py:122` 导入 `netshop.insights_common.actor_fence`，后者导入 NetshopImportBatch，Django 报该模型不在 INSTALLED_APPS。原测试只 override ROOT_URLCONF，不补装 app。该轮使用新增的 `tools/sales_performance_settings.py:5-7`，其 INSTALLED_APPS 是销售专用裁剪列表，确实没有 netshop；原默认 `backend/teruisi_backend/settings.py:128-142` 包含 `netshop.apps.NetshopConfig`。

`git diff bab42d8c..HEAD` 确认 finance、netshop、teruisi_backend 源码与这份 reserved-edge 测试未改；但是 sales_performance_settings 是本轮新增测试适配器，不能把它说成基线原配置。本复核没有重新加载 Django 或重跑基线数据库测试。因此此处的准确资格是**原失败栈 + 未修改业务源码 + 可静态证明的测试配置不适配**，不是声称在基线完整配置中独立重现了这 5 项失败。

后续如需该子集，使用包含其依赖 app 的隔离测试配置并保留私有数据库保护，或将销售专项 runner 的测试范围限于它实际支持的子集。不能靠修改 finance/netshop 业务代码消除这次 runner 错配；也不能将此解释替代组合总验收。

## 3. Node 中的 Python 合同：路径硬编码，环境变量不生效

以下源文件在基线与当前 HEAD 未改变。检查代码未发现它们读取 TERUISI_TEST_PYTHON 或 PYTHON：

| 文件 | 真实解释器选择 |
| --- | --- |
| `tests/business-market-options-envelope.test.ts:41` | `spawnSync(path.resolve(".runtime/test-venv/Scripts/python.exe"), ...)` |
| `tests/business-sales-options-envelope.test.ts:41` | 同上 |
| `tests/business-market-options.test.ts:58` | 同上 |
| `tests/business-sales-options.test.ts:59` | 同上 |
| `tests/promotion-keyword-sku-import.test.ts:8,56-57` | 先检查上述固定路径存在，再 spawnSync |

复核时本树 `.runtime/test-venv/Scripts/python.exe` 不存在。现有 `.runtime/performance-integration/python` 是另一个位置，即使设置 TERUISI_TEST_PYTHON 指向那里，也不会影响上述源文件。unit-all.log 中两份 envelope 为 spawnSync status `null !== 0`；JD 三项明确失败在 `Use the repository isolated pure-test Python runtime` 的存在性断言。原日志没有记录 spawn error 的 errno，因此不补写它已记录 ENOENT。

这里没有可提供的“正确覆盖环境变量”；现有合同要求本树精确路径。最小兼容方式是用确定解释器创建该位置的隔离标准库 venv，然后仅重跑这 5 个文件。它们的 Python 合同是纯 DTO/AST/SQLite 合成工作，不需要启动 Django 或生产连接。以下是交给总控的命令建议，本复核未执行环境创建与 Node 重跑：

```powershell
& 'C:\Users\86137\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m venv --without-pip '.runtime/test-venv'
node --import tsx --test tests/business-market-options-envelope.test.ts tests/business-sales-options-envelope.test.ts tests/business-market-options.test.ts tests/business-sales-options.test.ts tests/promotion-keyword-sku-import.test.ts
```

运行前应再确认目标仍不存在或属于本任务，避免覆盖其他协作者新建的环境。不要重写这些未修改测试来读取临时环境变量，也不要以复制正式虚拟环境/连接配置解决纯合同运行器路径问题。若补齐路径后还有断言失败，应按新失败继续分析，不能把它们预先判成环境问题。

本复核没有运行完整 Node 集合，也没有把正在执行的全库测试中其他失败归入以上结论。
