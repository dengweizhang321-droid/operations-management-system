# 已执行检查命令

工作目录为 `D:/codex-worktrees/prepared-artifact-loss-20261029`。本文件记录已执行的开发验证，不包含生产采用/核销命令。

依赖准备：`npm ci --ignore-scripts --no-audit --no-fund`，随后仅在本树运行既有 `node tools/install-xlsx-prototype-patch.mjs`。未修改 package.json 或 package-lock.json。

协议测试前，使用 `snapshot-history-fixture.py` 将八条已封存历史原始字节复制到本树 `.runtime/historical-queue-fixture`；原记录 SHA 与 history pins 一致。测试代码没有默认生产路径，缺副本就拒绝，不跳过断言。最终命令没有 skip/filter 参数：

```powershell
$env:TEMP = Join-Path (Get-Location) '.runtime\artifact-loss-tests'
$env:TMP = $env:TEMP
$env:TERUISI_HISTORICAL_QUEUE_FIXTURE = Join-Path (Get-Location) '.runtime\historical-queue-fixture'
$testFiles = @(
  'tests/main-prebuild-queue-v2.test.mjs'
  'tests/main-prebuild-queue-abandonment.test.mjs'
  'tests/main-prebuild-generation-rejection.test.mjs'
  'tests/manual-preparation-recovery.test.mjs'
  'tests/main-prebuild-hook.test.mjs'
  'tests/main-prebuild-eligibility.test.mjs'
  'tests/main-schema-selected-admission.test.mjs'
  'tests/publish-latest-main.test.mjs'
  'tests/preparation-resolution.test.mjs'
  'tests/preparation-superseded-resolution.test.mjs'
  'tests/main-prebuild-status.test.mjs'
  'tests/main-publication-readiness.test.mjs'
  'tests/preparation-retirement-entry.test.mjs'
  'tests/preparation-retirement-ref.test.mjs'
  'tests/prepared-artifact-loss.test.mjs'
)
node --test --test-reporter=tap @testFiles
```

结果：exit 0，161 passed / 0 failed / 0 skipped，83764.5ms。其中八条历史记录在一个原有历史兼容 case 中逐条验证。

CI 白名单以 PowerShell 按用户要求过滤空行与带前导空白的注释，参数与原命令相同：

```powershell
$ciFiles = @(Get-Content -LiteralPath '.github/workflows/ci-unit-test-files.txt' |
  Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' })
node --import tsx --test --test-timeout=30000 @ciFiles
```

冻结后结果：exit 0，66 passed / 0 failed / 0 skipped。

```powershell
npx eslint . --ignore-pattern '.claude/**' --format json --output-file .runtime/artifact-loss-tests/eslint-frozen.json
npm run check:backend-boundary
```

ESLint 完整扫描为 exit 1、56 errors /132 warnings；这是用户指定的保留基线口径，不冒称零错误。结构化逐项比较证明没有新增、替换或挪动错误。boundary 为 exit 0、violations: []。冻结后全部58项源码/测试摘要回查无变化。
