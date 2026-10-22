param(
  [Parameter(Mandatory = $true)][string]$StateRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{24}$')][string]$InstanceKey,
  [switch]$ValidateOnly,
  [string]$PreviewPath = "",
  [ValidateSet('', 'day', 'night')][string]$PreviewTheme = '',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

function Read-TextShared([string]$File) {
  # Allow the extension host to atomically replace snapshots while WPF reads them.
  $stream = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Read-Json([string]$File) {
  try { return ((Read-TextShared $File) | ConvertFrom-Json) } catch { return $null }
}
function Write-Json([string]$File, $Value) {
  $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($File))
  $temporary = $File + '.' + [guid]::NewGuid().ToString() + '.tmp'
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 15 -Compress), (New-Object Text.UTF8Encoding $false))
    # Same-directory replacement keeps readers from seeing a half-written command.
    if ([IO.File]::Exists($File)) { [IO.File]::Replace($temporary, $File, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $File) }
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function Now-Ms { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

$null = [IO.Directory]::CreateDirectory($StateRoot)
$mutex = New-Object Threading.Mutex($false, ('Local\Notifyer.Panel.' + $InstanceKey))
$ownsMutex = $false
$script:window = $null
$script:timer = $null
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { [Console]::Out.WriteLine('instance=already-running'); return }

  [xml]$layout = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'floating-panel.xaml') -Raw -Encoding UTF8
  $reader = New-Object Xml.XmlNodeReader $layout
  $script:window = [Windows.Markup.XamlReader]::Load($reader)
  $reader.Close()
  $script:collapsed = $false
  $script:theme = 'day'
  $script:desktopEnabled = $true
  $script:lastModel = ''
  $script:lastControl = ''
  $script:lastResponse = 0
  $script:lastLiveAt = Now-Ms
  $script:cards = @()
  $controls = @{}
  foreach ($name in @('Header','ThemeButton','NotificationButton','PinButton','CollapseButton','HideButton','RunningCount','UnreadCount','Body','ConnectionText','SessionScroll','SessionList','Footer')) {
    $controls[$name] = $script:window.FindName($name)
  }
  $dayPalette = @{}
  foreach ($key in @($script:window.Resources.Keys)) {
    if ($key -is [string]) { $dayPalette[$key] = $script:window.Resources[$key].ToString() }
  }
  $nightPalette = @{
    PanelBackground='#111C2D'; PanelBorder='#35445B'; TitleForeground='#F1F6FF'; MutedForeground='#8798B1'
    ButtonForeground='#CFD8E6'; ButtonBackground='#243249'; PinBackground='#245547'
    NotificationOn='#245547'; NotificationOff='#573B43'; RunningBackground='#1A2D41'; RunningForeground='#83C9FF'
    UnreadBackground='#352F27'; UnreadForeground='#F2C685'; CardBackground='#1A273B'; CardBorder='#2C3C53'
    UnreadBorder='#756044'; TextForeground='#ECF2FC'; Accent='#72DFC2'; ScrollThumb='#53647D'
  }

  $workArea = [Windows.SystemParameters]::WorkArea
  $script:window.Left = $workArea.Right - $script:window.Width - 24
  $script:window.Top = $workArea.Top + 80
  $preferencesPath = Join-Path $StateRoot 'preferences.json'
  $preferences = Read-Json $preferencesPath
  if ($preferences) {
    # Clamp saved positions after display layout/resolution changes.
    $script:window.Left = [Math]::Max($workArea.Left, [Math]::Min([double]$preferences.left, $workArea.Right - $script:window.Width))
    $script:window.Top = [Math]::Max($workArea.Top, [Math]::Min([double]$preferences.top, $workArea.Bottom - 160))
    $script:window.Topmost = [bool]$preferences.topmost
    $script:collapsed = [bool]$preferences.collapsed
    if ($preferences.theme -eq 'night') { $script:theme = 'night' }
  }
  if ($PreviewTheme) { $script:theme = $PreviewTheme }
  $notificationPolicyPath = Join-Path $StateRoot 'notification-policy.json'
  $notificationPolicy = Read-Json $notificationPolicyPath
  if ($notificationPolicy) { $script:desktopEnabled = $notificationPolicy.desktopEnabled -ne $false }
  function Save-Preferences {
    Write-Json $preferencesPath @{ left = $script:window.Left; top = $script:window.Top; topmost = $script:window.Topmost; collapsed = $script:collapsed; theme = $script:theme }
  }
  function Write-Heartbeat {
    Write-Json (Join-Path $StateRoot 'panel-heartbeat.json') @{
      pid = $PID; updatedAt = (Now-Ms); visible = $script:window.IsVisible; version = '0.4.2'; theme = $script:theme; desktopEnabled = $script:desktopEnabled
    }
  }
  function Update-Chrome {
    $controls.Body.Visibility = if ($script:collapsed) { 'Collapsed' } else { 'Visible' }
    $controls.CollapseButton.Content = if ($script:collapsed) { '+' } else { '−' }
    $controls.PinButton.Background = if ($script:window.Topmost) { $script:window.Resources['PinBackground'] } else { $script:window.Resources['ButtonBackground'] }
    $controls.ThemeButton.Content = if ($script:theme -eq 'night') { '夜晚' } else { '白天' }
    $controls.ThemeButton.ToolTip = if ($script:theme -eq 'night') { '当前为夜晚配色，点击切换白天' } else { '当前为白天配色，点击切换夜晚' }
    $controls.NotificationButton.Content = if ($script:desktopEnabled) { '桌面通知 开' } else { '桌面通知 关' }
    $controls.NotificationButton.Background = if ($script:desktopEnabled) { $script:window.Resources['NotificationOn'] } else { $script:window.Resources['NotificationOff'] }
  }
  function Theme-Color([string]$Key) { return $script:window.Resources[$Key].ToString() }
  function Apply-Theme {
    $palette = if ($script:theme -eq 'night') { $nightPalette } else { $dayPalette }
    $converter = New-Object Windows.Media.BrushConverter
    foreach ($key in $palette.Keys) { $script:window.Resources[$key] = $converter.ConvertFromString([string]$palette[$key]) }
    $script:lastModel = ''
    Update-Chrome
  }
  Apply-Theme
  $controls.Header.Add_MouseLeftButtonDown({
    param($sender, $event)
    $element = $event.OriginalSource
    while ($element -and $element -ne $controls.Header) {
      if ($element -is [Windows.Controls.Button]) { return }
      $element = [Windows.Media.VisualTreeHelper]::GetParent($element)
    }
    try { $script:window.DragMove(); Save-Preferences } catch {}
  })
  $controls.PinButton.Add_Click({ $script:window.Topmost = -not $script:window.Topmost; Update-Chrome; Save-Preferences })
  $controls.CollapseButton.Add_Click({ $script:collapsed = -not $script:collapsed; Update-Chrome; Save-Preferences })
  $controls.HideButton.Add_Click({ $script:window.Hide(); Save-Preferences })
  $controls.ThemeButton.Add_Click({
    $script:theme = if ($script:theme -eq 'day') { 'night' } else { 'day' }
    Apply-Theme; Save-Preferences; Refresh-Panel
  })
  $controls.NotificationButton.Add_Click({
    $script:desktopEnabled = -not $script:desktopEnabled
    Write-Json $notificationPolicyPath @{ desktopEnabled = $script:desktopEnabled; updatedAt = (Now-Ms) }
    Update-Chrome
    $controls.Footer.Text = if ($script:desktopEnabled) { '桌面通知已开启' } else { '桌面通知已关闭 · 待查看结果仍会保留' }
  })

  function Text-Element([string]$Text, [string]$Color, [double]$Size = 12) {
    $textBlock = New-Object Windows.Controls.TextBlock
    $textBlock.Text = $Text
    $textBlock.Foreground = $Color
    $textBlock.FontSize = $Size
    $textBlock.TextWrapping = 'Wrap'
    return $textBlock
  }
  function Mark-Read($Row) {
    if ([string]$Row.acknowledgement -notmatch '^[a-f0-9]{64}$') { return }
    Write-Json (Join-Path $StateRoot ('read\' + $Row.acknowledgement + '.json')) @{ at = (Now-Ms) }
    $script:lastModel = ''
  }
  function Request-Focus($Owner) {
    if (-not $Owner -or -not $Owner.online -or [string]$Owner.windowId -notmatch '^[a-f0-9-]+$') {
      $controls.Footer.Text = '该窗口已关闭或断连，请先打开对应的 VS Code 项目。'
      return
    }
    $commandFile = Join-Path $StateRoot ('commands\' + $Owner.windowId + '\' + [guid]::NewGuid().ToString() + '.json')
    Write-Json $commandFile @{ type = 'focus' }
    $controls.Footer.Text = '正在返回对应窗口… 对话需在窗口内选择。'
  }
  function Activate-Card($Card, [bool]$ShowMenu = $true) {
    if ($Card.Tag.stale) { $controls.Footer.Text = '窗口已断连，请先打开对应的 VS Code 项目。'; return }
    $owners = @($Card.Tag.owners | Where-Object { $_.online })
    if ($owners.Count -le 1) { Request-Focus ($owners | Select-Object -First 1); return }
    $menu = New-Object Windows.Controls.ContextMenu
    foreach ($owner in $owners) {
      $item = New-Object Windows.Controls.MenuItem
      $item.Header = $owner.label + ' · ' + ([string]$owner.windowId).Substring(0, 4)
      $item.Tag = $owner
      $item.Add_Click({ param($sender, $event) Request-Focus $sender.Tag })
      $null = $menu.Items.Add($item)
    }
    $Card.ContextMenu = $menu
    $menu.PlacementTarget = $Card
    $menu.Placement = 'MousePoint'
    if ($ShowMenu) { $menu.IsOpen = $true }
  }
  function Refresh-Panel {
    $control = Read-Json (Join-Path $StateRoot 'control.json')
    if ($control -and $control.id -ne $script:lastControl) {
      $script:lastControl = $control.id
      if ($control.type -eq 'hide') { $script:window.Hide() }
      if ($control.type -eq 'show') { $script:window.Show() }
    }
    $response = Read-Json (Join-Path $StateRoot 'response.json')
    if ($response -and [double]$response.at -gt $script:lastResponse) {
      $script:lastResponse = [double]$response.at
      $controls.Footer.Text = [string]$response.message
    }
    $modelFile = Join-Path $StateRoot 'model.json'
    try { $json = Read-TextShared $modelFile } catch { return }
    $model = $json | ConvertFrom-Json
    $policy = Read-Json $notificationPolicyPath
    if ($policy) { $script:desktopEnabled = $policy.desktopEnabled -ne $false }
    elseif ($model.PSObject.Properties['desktopNotificationsEnabled']) { $script:desktopEnabled = $model.desktopNotificationsEnabled -ne $false }
    Update-Chrome
    $now = Now-Ms
    if ($now - [double]$model.updatedAt -lt 15000) { $script:lastLiveAt = $now }
    $stale = $now - [double]$model.updatedAt -ge 15000
    # Heartbeat timestamps change independently of session content.
    $signature = ($model.rows | ConvertTo-Json -Depth 15 -Compress) + ':' + $stale + ':' + [Math]::Floor($now / 60000) + ':' + $script:theme
    $running = 0
    $pending = 0
    foreach ($row in @($model.rows)) {
      if ($row.status -eq 'running' -and -not $stale) { $running++ }
      if ($row.unread -and -not [IO.File]::Exists((Join-Path $StateRoot ('read\' + $row.acknowledgement + '.json')))) { $pending++ }
    }
    $controls.RunningCount.Text = '运行中  ' + $running
    $controls.UnreadCount.Text = '待查看  ' + $pending
    $controls.ConnectionText.Text = if ($stale) { 'VS Code 已关闭或连接中断' } else { '所有已连接窗口 · 仅运行中与待查看' }
    if ($signature -eq $script:lastModel) { return }
    $script:lastModel = $signature
    $scrollOffset = $controls.SessionScroll.VerticalOffset
    $controls.SessionList.Children.Clear()
    $script:cards = @()
    foreach ($row in @($model.rows)) {
      if (-not $row) { continue }
      $unread = $row.unread -and -not [IO.File]::Exists((Join-Path $StateRoot ('read\' + $row.acknowledgement + '.json')))
      $status = [string]$row.status
      if ($stale -and $status -eq 'running') { $status = 'unknown' }
      if ($status -ne 'running' -and -not $unread) { continue }
      $statusLabel = switch ($status) {
        'running' { '运行中' }
        'completed' { if ($unread) { '已完成 · 待查看' } else { '已完成 · 已查看' } }
        'failed' { if ($unread) { '发生错误 · 待查看' } else { '发生错误 · 已查看' } }
        default { '状态待确认' }
      }
      $color = if ($unread) { Theme-Color 'UnreadForeground' } else { Theme-Color 'RunningForeground' }
      $card = New-Object Windows.Controls.Border
      $card.Background = Theme-Color 'CardBackground'
      $card.BorderBrush = if ($unread) { Theme-Color 'UnreadBorder' } else { Theme-Color 'CardBorder' }
      $card.BorderThickness = '1'
      $card.CornerRadius = '7'
      $card.Padding = '12,10'
      $card.Margin = '0,0,0,8'
      $card.Cursor = 'Hand'
      $card.Focusable = $true
      $card.ToolTip = '点击切换到对应的 VS Code 窗口'
      $card.Tag = @{ owners = @($row.owners); stale = $stale }
      $card.Add_MouseLeftButtonUp({
        param($sender, $event)
        $element = $event.OriginalSource
        while ($element -and $element -ne $sender) {
          if ($element -is [Windows.Controls.Primitives.ButtonBase]) { return }
          $element = [Windows.Media.VisualTreeHelper]::GetParent($element)
        }
        $event.Handled = $true
        Activate-Card $sender
      })
      $card.Add_KeyDown({
        param($sender, $event)
        if ($event.OriginalSource -eq $sender -and $event.Key -in @('Return','Space')) { $event.Handled = $true; Activate-Card $sender }
      })
      $stack = New-Object Windows.Controls.StackPanel
      $card.Child = $stack
      $provider = if ($row.provider -eq 'codex') { 'Codex' } else { 'Claude' }
      $null = $stack.Children.Add((Text-Element ($provider + '  /  ' + $statusLabel) $color 11))
      $title = if ($row.title) { [string]$row.title } else { '会话 ' + ([string]$row.sessionId).Substring(0, [Math]::Min(8, ([string]$row.sessionId).Length)) }
      $heading = Text-Element $title (Theme-Color 'TextForeground') 13
      $heading.Margin = '0,6,0,5'
      $heading.MaxHeight = 42
      $heading.TextTrimming = 'CharacterEllipsis'
      $null = $stack.Children.Add($heading)
      $owners = @($row.owners)
      $owner = $owners | Where-Object { $_.online } | Select-Object -First 1
      $label = if ($owner) { [string]$owner.label } elseif ($owners.Count) { [string]$owners[0].label + ' · 已断连' } else { '来源窗口未知' }
      $timeLabel = if ($status -eq 'running') {
        '已运行 ' + [Math]::Max(0, [Math]::Floor(($now - [double]$row.startedAt) / 60000)) + ' 分钟'
      } else { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$row.updatedAt).ToLocalTime().ToString('MM-dd HH:mm') }
      $detail = Text-Element ($label + '  ·  ' + $timeLabel) (Theme-Color 'MutedForeground') 10
      $detail.ToolTip = [string]$row.cwd
      $null = $stack.Children.Add($detail)
      $actions = New-Object Windows.Controls.StackPanel
      $actions.Orientation = 'Horizontal'
      $actions.Margin = '0,9,0,0'
      if ($unread) {
        $read = New-Object Windows.Controls.Button
        $read.Content = '标记已查看'
        $read.FontSize = 10
        $read.Tag = $row
        $read.Add_Click({ param($sender, $event) $event.Handled = $true; Mark-Read $sender.Tag; Refresh-Panel })
        $null = $actions.Children.Add($read)
        $null = $stack.Children.Add($actions)
      }
      $null = $controls.SessionList.Children.Add($card)
      $script:cards += $card
    }
    if ($controls.SessionList.Children.Count -eq 0) {
      $empty = Text-Element "当前没有运行中或待查看的会话。" (Theme-Color 'MutedForeground') 12
      $empty.Margin = '4,18,4,18'
      $null = $controls.SessionList.Children.Add($empty)
    }
    $controls.SessionScroll.ScrollToVerticalOffset($scrollOffset)
  }
  Refresh-Panel

  if ($SelfTest) {
    if ($script:cards.Count -ne 2) { throw 'Panel must show only running and unread fixture rows.' }
    if ($script:theme -ne 'day') { throw 'The default theme must be day.' }
    $duplicateOutput = & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $PSCommandPath -StateRoot $StateRoot -InstanceKey $InstanceKey -ValidateOnly
    if ($LASTEXITCODE -ne 0 -or $duplicateOutput -notcontains 'instance=already-running') { throw 'Single-instance mutex failed' }
    $controls.CollapseButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ($controls.Body.Visibility -ne 'Collapsed') { throw 'Collapse failed' }
    $controls.CollapseButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    $initialPin = $script:window.Topmost
    $controls.PinButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ($script:window.Topmost -eq $initialPin) { throw 'Pin toggle failed' }
    $controls.PinButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    $controls.ThemeButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ($script:theme -ne 'night' -or (Read-Json $preferencesPath).theme -ne 'night') { throw 'Night theme must persist.' }
    $controls.ThemeButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ($script:theme -ne 'day') { throw 'Day theme toggle failed.' }
    $controls.NotificationButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ((Read-Json $notificationPolicyPath).desktopEnabled -ne $false) { throw 'Desktop notification mute failed.' }
    $controls.NotificationButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ((Read-Json $notificationPolicyPath).desktopEnabled -ne $true) { throw 'Desktop notification enable failed.' }
    $pendingRow = @((Read-Json (Join-Path $StateRoot 'model.json')).rows | Where-Object { $_.unread })[0]
    $click = New-Object Windows.Input.MouseButtonEventArgs ([Windows.Input.Mouse]::PrimaryDevice), 0, ([Windows.Input.MouseButton]::Left)
    $click.RoutedEvent = [Windows.UIElement]::MouseLeftButtonUpEvent
    $script:cards[0].RaiseEvent($click)
    $focusFiles = @(Get-ChildItem -LiteralPath (Join-Path $StateRoot ('commands\' + $pendingRow.owners[0].windowId)) -Filter '*.json')
    if ($focusFiles.Count -lt 1 -or (Read-Json $focusFiles[0].FullName).type -ne 'focus') { throw 'Focus IPC failed' }
    if ([IO.File]::Exists((Join-Path $StateRoot ('read\' + $pendingRow.acknowledgement + '.json')))) { throw 'Focus must not mark a result as read' }
    $firstCard = $script:cards[0]
    $firstCard.Tag.owners += @{ windowId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'; label = 'Second matching window'; online = $true }
    Activate-Card $firstCard $false
    if ($firstCard.ContextMenu.Items.Count -ne 2) { throw 'Matching-window chooser failed' }
    $firstCard.ContextMenu.Items[1].RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.MenuItem]::ClickEvent)))
    if (@(Get-ChildItem -LiteralPath (Join-Path $StateRoot 'commands\eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') -Filter '*.json').Count -ne 1) { throw 'Chosen window must receive focus IPC' }
    $firstActions = $script:cards[0].Child.Children[$script:cards[0].Child.Children.Count - 1]
    $firstActions.Children[0].RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if (-not [IO.File]::Exists((Join-Path $StateRoot ('read\' + $pendingRow.acknowledgement + '.json')))) { throw 'Read acknowledgement failed' }
    if ($script:cards.Count -ne 1 -or $controls.UnreadCount.Text -ne '待查看  0') { throw 'Reviewed results must disappear immediately.' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $StateRoot ('commands\' + $pendingRow.owners[0].windowId)) -Filter '*.json').Count -ne $focusFiles.Count) { throw 'Marking read must not activate a window.' }
    Remove-Item -LiteralPath (Join-Path $StateRoot ('read\' + $pendingRow.acknowledgement + '.json'))
    Write-Heartbeat
    $health = Read-Json (Join-Path $StateRoot 'panel-heartbeat.json')
    if ($health.pid -ne $PID -or $health.version -ne '0.4.2') { throw 'Panel heartbeat failed' }
    # A reader must not block replacement of a snapshot on Windows.
    $probe = Join-Path $StateRoot 'shared-read-test.json'
    Write-Json $probe @{ revision = 1 }
    $probeStream = [IO.File]::Open($probe, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try { Write-Json $probe @{ revision = 2 } } finally { $probeStream.Dispose() }
    if ((Read-Json $probe).revision -ne 2) { throw 'Atomic replacement during shared read failed' }
    $script:lastModel = ''
    Refresh-Panel
    $controls.Footer.Text = '点击会话切换窗口 · 查看结果后标记已查看'
    [Console]::Out.WriteLine('self-test=passed;cards=' + $script:cards.Count)
  }
  if ($PreviewPath) {
    # Render the actual WPF controls offscreen, without opening a desktop window.
    $content = $script:window.Content
    $content.Measure((New-Object Windows.Size 410, 1000))
    $content.Arrange((New-Object Windows.Rect 0, 0, 410, $content.DesiredSize.Height))
    $content.UpdateLayout()
    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap 410, ([int][Math]::Ceiling($content.ActualHeight)), 96, 96, ([Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($content)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create($PreviewPath)
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
    [Console]::Out.WriteLine('preview=' + $PreviewPath)
  }
  if ($ValidateOnly -or $PreviewPath -or $SelfTest) { return }

  $script:timer = New-Object Windows.Threading.DispatcherTimer
  $script:timer.Interval = [TimeSpan]::FromSeconds(1)
  $script:timer.Add_Tick({
    try {
      Refresh-Panel
      Write-Heartbeat
      # No orphan helper after all VS Code extension hosts have stopped.
      if ((Now-Ms) - $script:lastLiveAt -gt 60000) { $script:window.Close() }
    } catch {
      $controls.Footer.Text = '状态读取暂时失败，正在重试。'
    }
  })
  $script:window.Add_Closed({ $script:timer.Stop(); Save-Preferences; [Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() })
  $script:timer.Start()
  $script:window.Show()
  Write-Heartbeat
  # Unlike ShowDialog, a dispatcher loop continues while the window is hidden.
  [Windows.Threading.Dispatcher]::Run()
} catch {
  try { [IO.File]::WriteAllText((Join-Path $StateRoot 'panel-error.log'), ($_ | Out-String)) } catch {}
  throw
} finally {
  if ($script:timer) { $script:timer.Stop() }
  if ($ownsMutex) {
    $heartbeatFile = Join-Path $StateRoot 'panel-heartbeat.json'
    try { if ((Read-Json $heartbeatFile).pid -eq $PID) { [IO.File]::Delete($heartbeatFile) } } catch {}
  }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
