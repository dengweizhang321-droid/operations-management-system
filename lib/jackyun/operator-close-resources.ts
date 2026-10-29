import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import path from "node:path";
import { readJsonDurableOr } from "./json-file";
import { windowsPowerShellEnvironment } from "./windows-dpapi";
const run = promisify(execFile);

/** Conservative absence proof, never a process termination primitive. All
 * descendants of the owner/current helper and the dedicated profile must be
 * absent. Unknown inspection is blocked, not interpreted as absence. */
export async function assertJackyunCloseResourcesIdle(root: string, ownerPid?: number) {
  if (process.platform !== "win32") throw new Error("当前主机不支持吉客云资源退出核验。");
  const config = await readJsonDurableOr<{ profileDirectory: string; debuggingPort: number } | null>(path.join(root, "config/jackyun-login.json"), null);
  if (!config || !path.isAbsolute(config.profileDirectory) || !Number.isInteger(config.debuggingPort) || config.debuggingPort < 1 || config.debuggingPort > 65535) throw new Error("专用浏览器配置无法核实，不能闭合。");
  const parameters = Buffer.from(JSON.stringify({ profile: path.resolve(config.profileDirectory).toLowerCase().replaceAll("/", "\\"), port: config.debuggingPort,
    parents: [...new Set([process.pid, ...(ownerPid ? [ownerPid] : [])])] })).toString("base64");
  const program = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    $cfg=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${parameters}')) | ConvertFrom-Json
    $rows=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
    if($rows.Count -gt 8192){throw 'process census exceeded'}
    $desc=[Collections.Generic.HashSet[int]]::new(); foreach($n in $cfg.parents){[void]$desc.Add([int]$n)}
    for($i=0;$i -lt 64;$i++){ $changed=$false; foreach($p in $rows){if($desc.Contains([int]$p.ParentProcessId) -and [int]$p.ProcessId -ne $PID){if($desc.Add([int]$p.ProcessId)){$changed=$true}}}; if(-not $changed){break}; if($i -eq 63){throw 'process ancestry exceeded'}}
    $children=@($rows | Where-Object {$_.ProcessId -ne $PID -and $cfg.parents -notcontains $_.ProcessId -and $desc.Contains([int]$_.ProcessId)})
    $profile=@($rows | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.ToLowerInvariant().Replace('/','\\').Contains($cfg.profile) -or $_.CommandLine.Contains(('--remote-debugging-port='+$cfg.port))) })
    @{descendants=$children.Count;profileProcesses=$profile.Count} | ConvertTo-Json -Compress`;
  let observed: { descendants: number; profileProcesses: number };
  try {
    const result = await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(program, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15000, maxBuffer: 4096, encoding: "utf8", env: windowsPowerShellEnvironment() });
    observed = JSON.parse(result.stdout);
  } catch { throw new Error("无法确认原任务子进程和专用浏览器均已退出，暂不能闭合。"); }
  if (observed.descendants !== 0 || observed.profileProcesses !== 0) throw new Error("原任务仍有子进程或专用浏览器，请待资源退出后继续闭合。");
  const listening = await new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: config.debuggingPort });
    socket.setTimeout(2000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); reject(new Error("专用浏览器端口状态无法确认。")); });
    socket.once("error", error => { socket.destroy(); if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") resolve(false); else reject(new Error("专用浏览器端口状态无法确认。")); });
  });
  if (listening) throw new Error("专用浏览器端口仍被占用，暂不能闭合。");
  return { descendants: 0, profileProcesses: 0, portClosed: true };
}
