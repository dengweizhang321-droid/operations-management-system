# 实际命令与结果

在本独立树创建私有Python环境，先按backend/requirements.txt的锁定版本安装psycopg3.3.4；为无连接迁移图检查安装同文件的Django5.2.17等依赖。没有使用生产venv。Node依赖使用本树npm ci --ignore-scripts，并仅在本树运行既有XLSX补丁。

必需检查与声明生成由主代理实际执行：

```powershell
.runtime/check-venv/Scripts/python.exe -B docs/schema-code-digest-20261029/run-mandatory-checks.py
```

该脚本只生成本任务MANDATORY-CHECKS，不改recipe或validation；成功后主代理才把实际摘要/checkedAt/证据引用写入当前validation，再将其原字节SHA写入recipe。没有调用生产binder或生成原生PREPARED。

```powershell
.runtime/check-venv/Scripts/python.exe -B tools/check_schema_code_digest.py --recipe config/main-schema-releases/sales-0012.json
.runtime/check-venv/Scripts/python.exe -B tests/schema-code-digest-static.py
```

实际recipe检查passed/errors[]，真实86项摘要e411；15个私有测试通过，数据和原生执行全部隔离。检查器不代表必需检查已经执行，实际执行证据单独保留。

```powershell
node --test --test-reporter=tap --test-timeout=30000 tests/maintenance-controller-qualification.test.mjs
npx eslint . --ignore-pattern '.claude/**' --format json --output-file .runtime/eslint-schema-digest.json
npm run check:backend-boundary
npm run check:pi152-acl
$ciFiles = @(Get-Content -LiteralPath '.github/workflows/ci-unit-test-files.txt' |
  Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' })
node --import tsx --test --test-timeout=30000 @ciFiles
```

结果：控制器3/3、ESLint56errors/132warnings、boundary violations: []、ACL27/no_database=True、CI66/66。无--fix、无删除白名单、无门禁放宽。Node v24.18.0，Python3.14.6；PowerShell解析器版本见MANDATORY-CHECKS。
