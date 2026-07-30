param(
  [switch]$Check
)

# 本地运营管理系统控制面板：启动、停止并打开本地服务。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ServerUrl = "http://localhost:3000/"
$ServerPort = 3000
$LocalWorkerStarter = Join-Path $ProjectRoot "tools\start-local-worker.mjs"
$script:launchProcess = $null
$script:launchStartedAt = $null
$script:launchStdoutLog = $null
$script:launchStderrLog = $null

function Get-NodeExecutable {
  $systemNode = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if ($systemNode) {
    return $systemNode.Source
  }

  $codexRuntimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes"
  if (Test-Path $codexRuntimeRoot) {
    $bundledNode = Get-ChildItem -Path $codexRuntimeRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      ForEach-Object { Join-Path $_.FullName "dependencies\node\bin\node.exe" } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
    if ($bundledNode) {
      return $bundledNode
    }
  }

  return $null
}

function Get-PortProcesses {
  try {
    return @(Get-NetTCPConnection -State Listen -LocalPort $ServerPort -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    return @()
  }
}

function Get-SystemState {
  $portProcesses = Get-PortProcesses
  if ($portProcesses.Count -eq 0) {
    return [pscustomobject]@{ State = "Stopped"; ProcessIds = @() }
  }

  $managedProcessIds = @()
  foreach ($processId in $portProcesses) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.CommandLine -and $processInfo.CommandLine -like "*$ProjectRoot*") {
      $managedProcessIds += $processId
    }
  }

  if ($managedProcessIds.Count -gt 0) {
    return [pscustomobject]@{ State = "Running"; ProcessIds = $managedProcessIds }
  }

  return [pscustomobject]@{ State = "PortInUse"; ProcessIds = $portProcesses }
}

function Stop-ProcessTree {
  param(
    [int]$ProcessId,
    [object[]]$AllProcesses
  )

  foreach ($child in @($AllProcesses | Where-Object { $_.ParentProcessId -eq $ProcessId })) {
    Stop-ProcessTree -ProcessId $child.ProcessId -AllProcesses $AllProcesses
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if ($Check) {
  $currentState = Get-SystemState
  Write-Output "State: $($currentState.State)"
  exit 0
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "运营管理系统控制面板"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(430, 270)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(247, 249, 252)

$title = New-Object System.Windows.Forms.Label
$title.Text = "运营管理系统"
$title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 18, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(28, 24)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "本地启动与暂停控制"
$subtitle.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(92, 102, 117)
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(30, 64)

$statusDot = New-Object System.Windows.Forms.Label
$statusDot.Text = "●"
$statusDot.Font = New-Object System.Drawing.Font("Segoe UI", 18)
$statusDot.AutoSize = $true
$statusDot.Location = New-Object System.Drawing.Point(29, 105)

$status = New-Object System.Windows.Forms.Label
$status.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 11, [System.Drawing.FontStyle]::Bold)
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(57, 108)

$details = New-Object System.Windows.Forms.Label
$details.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$details.ForeColor = [System.Drawing.Color]::FromArgb(92, 102, 117)
$details.AutoSize = $true
$details.Location = New-Object System.Drawing.Point(31, 145)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "启动系统"
$startButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Bold)
$startButton.Size = New-Object System.Drawing.Size(115, 42)
$startButton.Location = New-Object System.Drawing.Point(31, 194)
$startButton.BackColor = [System.Drawing.Color]::FromArgb(28, 118, 235)
$startButton.ForeColor = [System.Drawing.Color]::White
$startButton.FlatStyle = "Flat"
$startButton.FlatAppearance.BorderSize = 0

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = "暂停／停止"
$stopButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)
$stopButton.Size = New-Object System.Drawing.Size(115, 42)
$stopButton.Location = New-Object System.Drawing.Point(158, 194)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = "打开系统"
$openButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)
$openButton.Size = New-Object System.Drawing.Size(115, 42)
$openButton.Location = New-Object System.Drawing.Point(285, 194)

$runContinueButton = New-Object System.Windows.Forms.Button
$runContinueButton.Text = "执行待处理继续任务"
$runContinueButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$runContinueButton.Size = New-Object System.Drawing.Size(175, 34)
$runContinueButton.Location = New-Object System.Drawing.Point(31, 240)
$runContinueButton.Enabled = $true

$viewLogButton = New-Object System.Windows.Forms.Button
$viewLogButton.Text = "查看启动日志"
$viewLogButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$viewLogButton.Size = New-Object System.Drawing.Size(175, 34)
$viewLogButton.Location = New-Object System.Drawing.Point(218, 240)
$viewLogButton.Enabled = $true

$form.ClientSize = New-Object System.Drawing.Size(430, 285)
$form.Controls.AddRange(@($title, $subtitle, $statusDot, $status, $details, $startButton, $stopButton, $openButton, $runContinueButton, $viewLogButton))

function Update-Status {
  $systemState = Get-SystemState
  switch ($systemState.State) {
    "Running" {
      $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(28, 160, 88)
      $status.Text = "系统正在运行"
      $details.Text = "访问地址：$ServerUrl"
      $startButton.Enabled = $false
      $stopButton.Enabled = $true
      $openButton.Enabled = $true
    }
    "Stopped" {
      if ($script:launchProcess -and -not $script:launchProcess.HasExited) {
        $elapsed = [math]::Floor(((Get-Date) - $script:launchStartedAt).TotalSeconds)
        $statusDot.ForeColor = if ($elapsed -ge 180) { [System.Drawing.Color]::FromArgb(224, 133, 27) } else { [System.Drawing.Color]::FromArgb(28, 118, 235) }
        $status.Text = if ($elapsed -ge 180) { "启动耗时较长…" } else { "正在启动…" }
        $details.Text = "正在构建并启动本地 Worker（已等待 $elapsed 秒）。日志：$($script:launchStdoutLog)"
        $startButton.Enabled = $false
        $stopButton.Enabled = $true
        $openButton.Enabled = $false
      } elseif ($script:launchProcess -and $script:launchProcess.HasExited) {
        $script:launchProcess.WaitForExit()
        $script:launchProcess.Refresh()
        $exitCode = $script:launchProcess.ExitCode
        if ($null -eq $exitCode -or "$exitCode" -eq "") {
          $exitCode = "未知"
        }
        if ($exitCode -ne 0) {
          $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(202, 64, 64)
          $status.Text = "启动失败，退出码 $exitCode"
          $details.Text = "请点击【查看启动日志】。错误日志：$($script:launchStderrLog)"
          $startButton.Enabled = $true
          $stopButton.Enabled = $false
          $openButton.Enabled = $false
        } else {
          $script:launchProcess = $null
          $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(148, 158, 173)
          $status.Text = "系统已暂停"
          $details.Text = "本地 Worker 已退出。点击【启动系统】可重新启动。"
          $startButton.Enabled = $true
          $stopButton.Enabled = $false
          $openButton.Enabled = $false
        }
      } else {
        $script:launchProcess = $null
        $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(148, 158, 173)
        $status.Text = "系统已暂停"
        $details.Text = "点击【启动系统】即可构建并恢复本地 Worker 服务。"
        $startButton.Enabled = $true
        $stopButton.Enabled = $false
        $openButton.Enabled = $false
      }
    }
    "PortInUse" {
      $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(224, 133, 27)
      $status.Text = "端口 3000 正被其他程序使用"
      $details.Text = "为避免影响其他程序，控制面板不会停止该程序。"
      $startButton.Enabled = $false
      $stopButton.Enabled = $false
      $openButton.Enabled = $false
    }
  }
}

$startButton.Add_Click({
  if (-not (Test-Path $LocalWorkerStarter)) {
    [System.Windows.Forms.MessageBox]::Show("未找到系统启动文件。请确认此控制面板位于项目目录中。", "无法启动", "OK", "Error") | Out-Null
    return
  }

  $nodeExecutable = Get-NodeExecutable
  if (-not $nodeExecutable) {
    [System.Windows.Forms.MessageBox]::Show("未找到 Node.js。请安装 Node.js 22.13 或更高版本后重试。", "无法启动", "OK", "Error") | Out-Null
    return
  }

  $actionState = Get-SystemState
  if ($actionState.State -eq "Running") {
    [System.Windows.Forms.MessageBox]::Show("运营管理系统已经在运行，无需重复构建。", "系统已运行", "OK", "Information") | Out-Null
    Update-Status
    return
  }
  if ($actionState.State -eq "PortInUse") {
    [System.Windows.Forms.MessageBox]::Show("端口 3000 正被其他程序使用。为避免覆盖运行中的构建，本次启动已取消。", "无法启动", "OK", "Warning") | Out-Null
    Update-Status
    return
  }

  $logDirectory = Join-Path $ProjectRoot "tmp"
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $script:launchStdoutLog = Join-Path $logDirectory "local-worker-panel-$stamp.stdout.log"
  $script:launchStderrLog = Join-Path $logDirectory "local-worker-panel-$stamp.stderr.log"
  $script:launchStartedAt = Get-Date
  $script:launchProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @("`"$LocalWorkerStarter`"", "--build") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $script:launchStdoutLog -RedirectStandardError $script:launchStderrLog -PassThru
  Update-Status
})

$stopButton.Add_Click({
  $systemState = Get-SystemState
  if ($script:launchProcess -and -not $script:launchProcess.HasExited) {
    $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    Stop-ProcessTree -ProcessId $script:launchProcess.Id -AllProcesses $allProcesses
    $script:launchProcess = $null
    Update-Status
    return
  }
  if ($systemState.State -ne "Running") {
    Update-Status
    return
  }

  $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  foreach ($processId in $systemState.ProcessIds) {
    Stop-ProcessTree -ProcessId $processId -AllProcesses $allProcesses
  }

  $script:launchProcess = $null
  Start-Sleep -Milliseconds 500
  Update-Status
})

$openButton.Add_Click({
  if ((Get-SystemState).State -eq "Running") {
    Start-Process $ServerUrl
  } else {
    Update-Status
  }
})

$runContinueButton.Add_Click({
  $nodeExecutable = Get-NodeExecutable
  if (-not $nodeExecutable) {
    [System.Windows.Forms.MessageBox]::Show("未找到 Node.js。请安装 Node.js 22.13 或更高版本后重试。", "无法执行", "OK", "Error") | Out-Null
    return
  }

  $helperScript = Join-Path $ProjectRoot "tools\jackyun-continue-helper.ts"
  if (-not (Test-Path $helperScript)) {
    [System.Windows.Forms.MessageBox]::Show("未找到继续任务脚本。", "无法执行", "OK", "Error") | Out-Null
    return
  }

  $runContinueButton.Enabled = $false
  $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(28, 118, 235)
  $status.Text = "正在执行待处理任务…"
  $details.Text = "请保持吉客云已登录状态。"
  $form.Refresh()

  Start-Process -FilePath $nodeExecutable -ArgumentList @("--import", "tsx", $helperScript) -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null
  Start-Sleep -Milliseconds 500
  Update-Status
  $runContinueButton.Enabled = $true
})

$viewLogButton.Add_Click({
  $logPath = if ($script:launchStderrLog -and (Test-Path $script:launchStderrLog) -and (Get-Item $script:launchStderrLog).Length -gt 0) { $script:launchStderrLog } else { $script:launchStdoutLog }
  if (-not $logPath -or -not (Test-Path $logPath)) {
    [System.Windows.Forms.MessageBox]::Show("尚未生成启动日志。请先启动系统。", "暂无日志", "OK", "Information") | Out-Null
    return
  }
  Start-Process -FilePath "notepad.exe" -ArgumentList @("`"$logPath`"")
})

$statusTimer = New-Object System.Windows.Forms.Timer
$statusTimer.Interval = 2000
$statusTimer.Add_Tick({ Update-Status })
$form.Add_Shown({
  Update-Status
  $statusTimer.Start()
})
$form.Add_FormClosed({ $statusTimer.Stop() })

[void]$form.ShowDialog()
