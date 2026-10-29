# 实际检查命令

工作目录为本独立开发树。D08三文件精确副本在 `.runtime/pinned-native`，摘要与来源见BASELINE；历史八份只读证据副本在 `.runtime/historical-queue-fixture`。两类输入均在测试前准备，测试没有生产路径回退。

```powershell
$env:TEMP = Join-Path (Get-Location) '.runtime/artifact-loss-tests'
$env:TMP = $env:TEMP
$env:TERUISI_HISTORICAL_QUEUE_FIXTURE = Join-Path (Get-Location) '.runtime/historical-queue-fixture'
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
  'tests/prepared-artifact-loss-native-lock.test.mjs'
)
node --test --test-reporter=tap @testFiles
```

16文件实际171通过、0失败、0跳过，82761.4334ms。新suite的子进程自身固定TEMP/TMP到本树 `.runtime/native-lock-tests`，三文件固定摘要和路径验证不允许用repo新native替换D08副本。

```powershell
$ciFiles = @(Get-Content -LiteralPath '.github/workflows/ci-unit-test-files.txt' |
  Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' })
node --import tsx --test --test-timeout=30000 @ciFiles
npx eslint . --ignore-pattern '.claude/**' --format json --output-file .runtime/native-lock-tests/eslint-final.json
npm run check:backend-boundary
```

CI为66/66；ESLint是指定保留基线的56errors而非零错误；backend boundary无violation。没有`--fix`、skip、测试白名单删项或规则放宽。
