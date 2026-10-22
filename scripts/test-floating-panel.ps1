param([string]$OutputDirectory = (Join-Path $env:TEMP ('notifyer-panel-test-' + [guid]::NewGuid().ToString())))
$ErrorActionPreference = 'Stop'
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$owner = @{ windowId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; label = 'Notifyer / 本地'; online = $true }
$rows = @(
  @{ key = 'codex:a'; provider = 'codex'; sessionId = 'session-a'; turnId = 'a'; title = '为 Notifyer 添加桌面会话悬浮窗'; cwd = 'F:\projects\Notifyer'; status = 'completed'; unread = $true; acknowledgement = ('a' * 64); startedAt = ($now - 600000); updatedAt = ($now - 120000); owners = @($owner) },
  @{ key = 'claude:b'; provider = 'claude'; sessionId = 'session-b'; turnId = 'b'; title = '训练模型并验证精度'; cwd = '/home/user/model'; status = 'running'; unread = $false; acknowledgement = ('b' * 64); startedAt = ($now - 1380000); updatedAt = $now; owners = @(@{ windowId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; label = 'Model / SSH'; online = $true }) },
  @{ key = 'codex:c'; provider = 'codex'; sessionId = 'session-c'; turnId = 'c'; title = '检查远程构建结果'; cwd = '/home/user/build'; status = 'unknown'; unread = $false; acknowledgement = ('c' * 64); startedAt = ($now - 1800000); updatedAt = ($now - 600000); owners = @(@{ windowId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; label = 'Build / SSH'; online = $false }) },
  @{ key = 'codex:d'; provider = 'codex'; sessionId = 'session-d'; turnId = 'd'; title = '已查看的历史结果'; cwd = 'F:\projects\Notifyer'; status = 'completed'; unread = $false; acknowledgement = ('d' * 64); startedAt = ($now - 600000); updatedAt = ($now - 600000); owners = @($owner) }
)
$encoding = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'model.json'), (@{ updatedAt = $now; rows = $rows; desktopNotificationsEnabled = $true } | ConvertTo-Json -Depth 12), $encoding)
$preview = Join-Path $OutputDirectory 'floating-panel-preview.png'
$scriptFile = Join-Path $PSScriptRoot '..\resources\floating-panel.ps1'
$instanceKey = [guid]::NewGuid().ToString('N').Substring(0, 24)
& powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $scriptFile -StateRoot $OutputDirectory -InstanceKey $instanceKey -SelfTest -PreviewPath $preview
if ($LASTEXITCODE -ne 0) { throw 'WPF validation failed' }
if (-not (Test-Path -LiteralPath $preview)) { throw 'WPF preview missing' }
$nightPreview = Join-Path $OutputDirectory 'floating-panel-night-preview.png'
& powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $scriptFile -StateRoot $OutputDirectory -InstanceKey $instanceKey -PreviewPath $nightPreview -PreviewTheme night
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nightPreview)) { throw 'Night theme preview missing' }
Write-Output ('artifacts=' + $OutputDirectory)
