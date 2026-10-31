<#
.SYNOPSIS
  Worker 持久数据（本地 R2 附件/图片）独立备份与校验。

.DESCRIPTION
  阶段 0 行动卡 A1。备份 D:\运营管理系统\.wrangler\state\v3\r2 到第二块物理磁盘。

  设计约束（来自 docs/系统改造-阶段0-20261024/行动卡.md）：
  - 本脚本不 import 任何发布链模块。tools/release-daily-backup.mjs 依赖
    worker-local-release.mjs / worker-local-release-rotation.mjs，并以
    D:\.codex\automations\e\automation.toml 的 status=ACTIVE 作为调度门禁；
    附件备份若挂在它上面，会在发布链改造期间一起失效。
  - 源目录全程只读。本脚本不对源执行任何写操作。
  - 不备份 .dev.vars：内含生产密钥，明文复制到第二块盘会扩大暴露面
    （审查 #31：同一 Windows 用户下任何进程都可解密）。密钥另走加密路径。
  - 不备份 v3/d1：那是 8.93 GiB 的 Miniflare D1 SQLite，属一次性冷归档对象而非
    日常轮转对象。2026-10-24 实测它并非空壳：finance_lines 有 40,233 行
    （2025-01~2026-07），且库内 11 条域退役回执独缺 finance。归档前须连
    PostgreSQL 核对行数与月份覆盖，见 docs/系统改造-阶段0-20261024/行动卡.md B2。

.PARAMETER Action
  Inventory  清点源目录，不复制
  Backup     全量/增量复制 + 生成 SHA-256 清单
  Verify       按清单校验备份完整性（-SampleSize 指定抽样数，0 为全量）
  RestoreTest  恢复验证：从 R2 元数据索引取对象 key，解析到 blob 文件，比对 size 与 etag。
               这一步证明备份「可恢复可用」，而非仅字节完好——R2 数据由
               site-creator-r2/blobs（对象内容，裸文件无名）和
               miniflare-R2BucketObject/*.sqlite（key -> blob_id 索引）两半组成，
               缺索引则 blobs 只是一堆无名二进制。

.EXAMPLE
  powershell -NoProfile -File tools\worker-state-backup.ps1 -Action Inventory
  powershell -NoProfile -File tools\worker-state-backup.ps1 -Action Backup
  powershell -NoProfile -File tools\worker-state-backup.ps1 -Action Verify -SampleSize 20
  powershell -NoProfile -File tools\worker-state-backup.ps1 -Action RestoreTest -SampleSize 20
#>
[CmdletBinding()]
param(
  [ValidateSet('Inventory', 'Backup', 'Verify', 'RestoreTest')]
  [string]$Action = 'Inventory',

  [string]$SourceRoot = 'D:\运营管理系统\.wrangler\state\v3\r2',
  [string]$TargetRoot = 'E:\teruisi-backup\worker-state',

  # 校验抽样数量。0 = 全量校验（39,846 个文件，耗时长）
  [int]$SampleSize = 20,

  # robocopy 线程数
  [int]$Threads = 16
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ManifestName = 'manifest-sha256.csv'
$ReportName   = 'backup-report.json'

function Write-Stage([string]$Text) {
  Write-Host ''
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Assert-SeparatePhysicalDisk([string]$Source, [string]$Target) {
  # 备份必须落在不同物理磁盘，否则单盘故障时同时丢失
  $srcLetter = ($Source -replace '^([A-Za-z]):.*$', '$1')
  $dstLetter = ($Target -replace '^([A-Za-z]):.*$', '$1')
  $map = @{}
  Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object {
    $map[[string]$_.DriveLetter] = $_.DiskNumber
  }
  if (-not $map.ContainsKey($srcLetter) -or -not $map.ContainsKey($dstLetter)) {
    Write-Warning "无法确定物理磁盘映射（源 $srcLetter / 目标 $dstLetter），跳过同盘检查。"
    return
  }
  if ($map[$srcLetter] -eq $map[$dstLetter]) {
    throw "源与目标在同一物理磁盘（Disk $($map[$srcLetter])）。备份必须落在第二块盘。"
  }
  Write-Host "物理磁盘检查通过：源 $srcLetter -> Disk $($map[$srcLetter])，目标 $dstLetter -> Disk $($map[$dstLetter])"
}

function Get-SourceInventory([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root)) { throw "源目录不存在：$Root" }
  $files = Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Files    = $files.Count
    Bytes    = ($files | Measure-Object Length -Sum).Sum
    Newest   = ($files | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    FileList = $files
  }
}

function New-Manifest {
  param([System.IO.FileInfo[]]$Files, [string]$Root, [string]$OutPath)

  $total = $Files.Count
  $i = 0
  $rows = foreach ($f in $Files) {
    $i++
    if ($i % 2000 -eq 0) {
      Write-Progress -Activity '生成 SHA-256 清单' -Status "$i / $total" -PercentComplete (100 * $i / $total)
    }
    $rel = $f.FullName.Substring($Root.Length).TrimStart('\')
    [pscustomobject]@{
      RelativePath  = $rel
      Bytes         = $f.Length
      Sha256        = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
      LastWriteUtc  = $f.LastWriteTimeUtc.ToString('o')
    }
  }
  Write-Progress -Activity '生成 SHA-256 清单' -Completed
  $rows | Export-Csv -LiteralPath $OutPath -NoTypeInformation -Encoding UTF8
  return $rows.Count
}

switch ($Action) {

  'Inventory' {
    Write-Stage '源目录清点'
    $inv = Get-SourceInventory $SourceRoot
    Write-Host "源目录   : $SourceRoot"
    Write-Host "文件数   : $($inv.Files)"
    Write-Host "体积     : $([math]::Round($inv.Bytes / 1GB, 2)) GiB（$($inv.Bytes) 字节）"
    Write-Host "最近写入 : $($inv.Newest)"
    Write-Host ''
    Write-Host "目标目录 : $TargetRoot"
    Assert-SeparatePhysicalDisk $SourceRoot $TargetRoot
  }

  'Backup' {
    Write-Stage '前置检查'
    Assert-SeparatePhysicalDisk $SourceRoot $TargetRoot
    $inv = Get-SourceInventory $SourceRoot
    Write-Host "源：$($inv.Files) 个文件，$([math]::Round($inv.Bytes / 1GB, 2)) GiB（$($inv.Bytes) 字节）"

    $dataRoot = Join-Path $TargetRoot 'r2'
    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null

    $freeBytes = (Get-PSDrive -Name ($TargetRoot -replace '^([A-Za-z]):.*$', '$1')).Free
    if ($freeBytes -lt $inv.Bytes * 1.1) {
      throw "目标盘可用空间不足：需要约 $([math]::Round($inv.Bytes * 1.1 / 1GB, 1)) GiB，实有 $([math]::Round($freeBytes / 1GB, 1)) GiB。"
    }

    Write-Stage '复制（robocopy，源只读）'
    $started = Get-Date
    # /MIR 镜像；/FFT 容忍 FAT 时间精度；/R:2 /W:5 降低锁文件重试成本
    # /XJ 不跟随 junction，避免循环；/NFL /NDL 只输出摘要
    $log = Join-Path $TargetRoot 'robocopy.log'
    $rc = Start-Process -FilePath 'robocopy.exe' -Wait -PassThru -NoNewWindow -ArgumentList @(
      "`"$SourceRoot`"", "`"$dataRoot`"", '/MIR', '/FFT', '/XJ',
      "/MT:$Threads", '/R:2', '/W:5', '/NFL', '/NDL', '/NP',
      "/LOG+:`"$log`""
    )
    # robocopy 退出码 0-7 为成功（8+ 才是错误）
    if ($rc.ExitCode -ge 8) {
      throw "robocopy 失败，退出码 $($rc.ExitCode)。详见 $log"
    }
    Write-Host "robocopy 完成，退出码 $($rc.ExitCode)（<8 为成功）"

    Write-Stage '生成 SHA-256 清单（基于备份副本）'
    # 对副本算哈希：既校验副本完整性，又避免给源盘增加读压力之外的任何写入
    $copied = Get-ChildItem -LiteralPath $dataRoot -Recurse -File -Force -ErrorAction SilentlyContinue
    $manifestPath = Join-Path $TargetRoot $ManifestName
    $count = New-Manifest -Files $copied -Root $dataRoot -OutPath $manifestPath
    Write-Host "清单已写入：$manifestPath（$count 条）"

    $report = [pscustomobject]@{
      generatedAt     = (Get-Date).ToString('o')
      sourceRoot      = $SourceRoot
      targetRoot      = $TargetRoot
      sourceFiles     = $inv.Files
      sourceBytes     = $inv.Bytes
      copiedFiles     = $copied.Count
      copiedBytes     = ($copied | Measure-Object Length -Sum).Sum
      manifestEntries = $count
      robocopyExit    = $rc.ExitCode
      elapsedMinutes  = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
      note            = '不含 .dev.vars（生产密钥，另走加密路径）；不含 v3/d1（8.93 GiB SQLite，内含 finance_lines 40233 行且缺 finance 退役回执，归档前须连 PG 核对，见行动卡 B2）'
    }
    $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $TargetRoot $ReportName) -Encoding UTF8

    Write-Stage '结果'
    $report | Format-List
    if ($copied.Count -ne $inv.Files) {
      Write-Warning "副本文件数 $($copied.Count) 与源 $($inv.Files) 不一致。源目录在备份期间可能有写入，请复查。"
    }
  }

  'Verify' {
    Write-Stage '校验备份'
    $manifestPath = Join-Path $TargetRoot $ManifestName
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "清单不存在：$manifestPath。先执行 -Action Backup。" }
    $dataRoot = Join-Path $TargetRoot 'r2'
    $rows = Import-Csv -LiteralPath $manifestPath

    $targets = if ($SampleSize -gt 0 -and $SampleSize -lt $rows.Count) {
      Write-Host "随机抽样 $SampleSize / $($rows.Count) 条"
      $rows | Get-Random -Count $SampleSize
    } else {
      Write-Host "全量校验 $($rows.Count) 条"
      $rows
    }

    $ok = 0; $bad = @(); $missing = @()
    $i = 0
    foreach ($row in $targets) {
      $i++
      if ($i % 500 -eq 0) { Write-Progress -Activity '校验' -Status "$i / $($targets.Count)" -PercentComplete (100 * $i / $targets.Count) }
      $p = Join-Path $dataRoot $row.RelativePath
      if (-not (Test-Path -LiteralPath $p)) { $missing += $row.RelativePath; continue }
      $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
      if ($h -eq $row.Sha256) { $ok++ } else { $bad += $row.RelativePath }
    }
    Write-Progress -Activity '校验' -Completed

    Write-Host ''
    Write-Host "通过   : $ok"
    Write-Host "哈希错 : $($bad.Count)"
    Write-Host "缺失   : $($missing.Count)"
    if ($bad.Count)     { Write-Host '--- 哈希不匹配 ---'; $bad     | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" } }
    if ($missing.Count) { Write-Host '--- 缺失 ---';       $missing | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" } }

    if ($bad.Count -or $missing.Count) {
      Write-Error "校验未通过：哈希错 $($bad.Count)，缺失 $($missing.Count)。"
      exit 1
    }
    Write-Host ''
    Write-Host '校验通过。' -ForegroundColor Green
  }

  'RestoreTest' {
    Write-Stage '恢复验证（索引 key -> blob 文件）'
    $dataRoot = Join-Path $TargetRoot 'r2'
    $idxDir = Join-Path $dataRoot 'miniflare-R2BucketObject'
    if (-not (Test-Path -LiteralPath $idxDir)) { throw "未找到 R2 元数据目录：$idxDir" }

    # 索引库是该目录下非 metadata 的 .sqlite
    $idx = Get-ChildItem -LiteralPath $idxDir -Filter '*.sqlite' -File |
      Where-Object { $_.Name -notlike 'metadata*' } |
      Select-Object -First 1
    if (-not $idx) { throw "未找到 R2 对象索引库（$idxDir 下非 metadata 的 .sqlite）" }
    Write-Host "索引库：$($idx.Name)"

    $blobRoot = Join-Path $dataRoot 'site-creator-r2\blobs'
    if (-not (Test-Path -LiteralPath $blobRoot)) { throw "未找到 blobs 目录：$blobRoot" }

    # 用 Python 读 sqlite（本机无 sqlite3 CLI，但 python 自带 sqlite3 模块）
    $py = @'
import sqlite3, os, hashlib, random, sys, json
idx, blobs, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
con = sqlite3.connect(f"file:{idx}?mode=ro&immutable=1", uri=True)
rows = con.execute("select key, blob_id, size, etag, http_metadata from _mf_objects").fetchall()
con.close()
print(f"index_objects={len(rows)}")
blob_n = sum(len(f) for _, _, f in os.walk(blobs))
print(f"blob_files={blob_n}")
sample = rows if n <= 0 or n >= len(rows) else random.sample(rows, n)
ok = bad = miss = 0
for key, blob_id, size, etag, hm in sample:
    p = os.path.join(blobs, blob_id)
    if not os.path.exists(p):
        print(f"MISSING {key[:70]}"); miss += 1; continue
    if os.path.getsize(p) != size:
        print(f"SIZE    {key[:70]}"); bad += 1; continue
    if etag and hashlib.md5(open(p, "rb").read()).hexdigest() != etag:
        print(f"ETAG    {key[:70]}"); bad += 1; continue
    ok += 1
print(f"result ok={ok} bad={bad} missing={miss} sampled={len(sample)}")
sys.exit(0 if (bad == 0 and miss == 0) else 1)
'@
    $tmp = Join-Path $env:TEMP "r2-restore-test-$PID.py"
    Set-Content -LiteralPath $tmp -Value $py -Encoding UTF8
    try {
      # -I 隔离模式：不加载当前目录和用户 site-packages
      & python -I $tmp $idx.FullName $blobRoot $SampleSize
      $code = $LASTEXITCODE
    } finally {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }

    if ($code -ne 0) {
      Write-Error '恢复验证未通过。'
      exit 1
    }
    Write-Host ''
    Write-Host '恢复验证通过：索引中的对象 key 均能解析到 blob 文件，size 与 etag 一致。' -ForegroundColor Green
  }
}
