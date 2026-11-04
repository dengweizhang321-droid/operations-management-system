# 已执行命令

工作目录为本独立开发树。没有修改禁改四文件，未执行任何PS控制器或生产门禁。

```powershell
node --test --test-timeout=30000 --test-reporter=tap tests/maintenance-controller-qualification.test.mjs
```

同一份ab4原字节test：登记前2通过/1失败；追加资格后3通过/0失败/0跳过。

```powershell
node --test --test-reporter=tap --test-timeout=30000 --test-name-pattern='reviewed Django|A项:|B项:|S04a:|S05a:|Sales154:' tests/manual-maintenance-continuation.test.mjs
```

六个资格合同用例实际通过。筛选明确排除了该文件中读取生产原生transport的Windows专属用例，未跑完整文件，不把6/6当作该文件全量验收。

```powershell
npx eslint . --ignore-pattern '.claude/**' --format json --output-file .runtime/qualification/eslint-final.json
npm run check:backend-boundary
npm run check:pi152-acl
$ciFiles = @(Get-Content -LiteralPath '.github/workflows/ci-unit-test-files.txt' |
  Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' })
node --import tsx --test --test-timeout=30000 @ciFiles
```

结果分别为56errors/132warnings、violations: []、27 ACL checks/no_database=True、66/66。无`--fix`，没有删改CI白名单或调整ESLint规则。新资格静态检查另接独立CI step，不改变66项集合。
