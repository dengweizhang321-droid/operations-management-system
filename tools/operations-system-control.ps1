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
$VinextCli = Join-Path $ProjectRoot "node_modules\vinext\dist\cli.js"

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

$form.Controls.AddRange(@($title, $subtitle, $statusDot, $status, $details, $startButton, $stopButton, $openButton))

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
    "PortInUse" {
      $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(224, 133, 27)
      $status.Text = "端口 3000 正被其他程序使用"
      $details.Text = "为避免影响其他程序，控制面板不会停止该程序。"
      $startButton.Enabled = $false
      $stopButton.Enabled = $false
      $openButton.Enabled = $false
    }
    default {
      $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(148, 158, 173)
      $status.Text = "系统已暂停"
      $details.Text = "点击【启动系统】即可恢复服务。"
      $startButton.Enabled = $true
      $stopButton.Enabled = $false
      $openButton.Enabled = $false
    }
  }
}

$startButton.Add_Click({
  if (-not (Test-Path $VinextCli)) {
    [System.Windows.Forms.MessageBox]::Show("未找到系统启动文件。请确认此控制面板位于项目目录中。", "无法启动", "OK", "Error") | Out-Null
    return
  }

  $nodeExecutable = Get-NodeExecutable
  if (-not $nodeExecutable) {
    [System.Windows.Forms.MessageBox]::Show("未找到 Node.js。请安装 Node.js 22.13 或更高版本后重试。", "无法启动", "OK", "Error") | Out-Null
    return
  }

  $startButton.Enabled = $false
  $statusDot.ForeColor = [System.Drawing.Color]::FromArgb(28, 118, 235)
  $status.Text = "正在启动…"
  $details.Text = "首次启动可能需要几十秒。"
  $form.Refresh()

  Start-Process -FilePath $nodeExecutable -ArgumentList @("`"$VinextCli`"", "dev") -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null

  $started = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    Start-Sleep -Seconds 1
    if ((Get-SystemState).State -eq "Running") {
      $started = $true
      break
    }
  }

  Update-Status
  if (-not $started) {
    [System.Windows.Forms.MessageBox]::Show("系统未能在 45 秒内启动。请检查 Node.js 是否可用，或确认端口 3000 没有被占用。", "启动超时", "OK", "Warning") | Out-Null
  }
})

$stopButton.Add_Click({
  $systemState = Get-SystemState
  if ($systemState.State -ne "Running") {
    Update-Status
    return
  }

  $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  foreach ($processId in $systemState.ProcessIds) {
    Stop-ProcessTree -ProcessId $processId -AllProcesses $allProcesses
  }

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

$statusTimer = New-Object System.Windows.Forms.Timer
$statusTimer.Interval = 2000
$statusTimer.Add_Tick({ Update-Status })
$form.Add_Shown({
  Update-Status
  $statusTimer.Start()
})
$form.Add_FormClosed({ $statusTimer.Stop() })

[void]$form.ShowDialog()
