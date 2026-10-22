param(
  [Parameter(Mandatory = $true)][string]$StateRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{24}$')][string]$InstanceKey,
  [switch]$ValidateOnly,
  [switch]$StartHidden,
  [string]$PreviewPath = "",
  [ValidateSet('', 'day', 'night')][string]$PreviewTheme = '',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

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
function Saved-Dimension($Value, [double]$Default, [double]$Minimum, [double]$Maximum) {
  try {
    if ($null -ne $Value) {
      $number = [double]$Value
      if (-not [double]::IsNaN($number) -and -not [double]::IsInfinity($number) -and $number -gt 0) {
        return [Math]::Max($Minimum, [Math]::Min($number, $Maximum))
      }
    }
  } catch { }
  return $Default
}
function Resolve-PanelPosition([double]$Left, [double]$Top, [double]$Width, $Areas) {
  # Preserve the exact position whenever the header is reachable on any screen.
  $header = [Windows.Rect]::new($Left, $Top, $Width, 48)
  $closest = $null
  $closestDistance = [double]::PositiveInfinity
  foreach ($area in $Areas) {
    $intersection = [Windows.Rect]::Intersect($header, $area)
    if (-not $intersection.IsEmpty -and $intersection.Width -ge 64 -and $intersection.Height -ge 24) {
      return [pscustomobject]@{ left = $Left; top = $Top }
    }
    $centerX = $Left + $Width / 2
    $centerY = $Top + 24
    $dx = $centerX - [Math]::Max($area.Left, [Math]::Min($centerX, $area.Right))
    $dy = $centerY - [Math]::Max($area.Top, [Math]::Min($centerY, $area.Bottom))
    $distance = $dx * $dx + $dy * $dy
    if ($distance -lt $closestDistance) { $closest = $area; $closestDistance = $distance }
  }
  # If a display was removed, bring the panel back onto the closest display.
  return [pscustomobject]@{
    left = [Math]::Max($closest.Left, [Math]::Min($Left, $closest.Right - $Width))
    top = [Math]::Max($closest.Top, [Math]::Min($Top, $closest.Bottom - 160))
  }
}

$null = [IO.Directory]::CreateDirectory($StateRoot)
$mutex = New-Object Threading.Mutex($false, ('Local\Notifyer.Panel.' + $InstanceKey))
$ownsMutex = $false
$script:window = $null
$script:timer = $null
$script:geometryTimer = $null
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { [Console]::Out.WriteLine('instance=already-running'); return }

  [xml]$layout = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'floating-panel.xaml') -Raw -Encoding UTF8
  $reader = New-Object Xml.XmlNodeReader $layout
  $script:window = [Windows.Markup.XamlReader]::Load($reader)
  $reader.Close()
  $script:collapsed = $false
  $script:theme = 'day'
  $script:desktopEnabled = $false
  $script:lastModel = ''
  $script:lastControl = if ($StartHidden) { (Read-Json (Join-Path $StateRoot 'control.json')).id } else { '' }
  $script:requestedVisible = -not $StartHidden
  $script:lastResponse = 0
  $script:lastLiveAt = Now-Ms
  $script:cards = @()
  $script:runningCount = 0
  $script:unreadCount = 0
  $script:rememberGeometry = $false
  $script:geometryCollapsed = $null
  $controls = @{}
  $resizeNames = @('ResizeN','ResizeS','ResizeW','ResizeE','ResizeNW','ResizeNE','ResizeSW','ResizeSE')
  foreach ($name in (@('Header','ThemeButton','NotificationButton','PinButton','CollapseButton','HideButton','RunningCount','UnreadCount','Body','ConnectionDot','SessionScroll','SessionList') + $resizeNames)) {
    $controls[$name] = $script:window.FindName($name)
  }
  $dayPalette = @{}
  foreach ($key in @($script:window.Resources.Keys)) {
    if ($key -is [string] -and $script:window.Resources[$key] -is [Windows.Media.Brush]) { $dayPalette[$key] = $script:window.Resources[$key].ToString() }
  }
  $nightPalette = @{
    PanelBackground='#111C2D'; PanelBorder='#35445B'; TitleForeground='#F1F6FF'; MutedForeground='#8798B1'
    ButtonForeground='#CFD8E6'; ButtonBackground='#243249'; PinBackground='#245547'
    NotificationOn='#245547'; NotificationOff='#573B43'; RunningBackground='#1A2D41'; RunningForeground='#83C9FF'
    UnreadBackground='#352F27'; UnreadForeground='#F2C685'; CardBackground='#1A273B'; CardBorder='#2C3C53'
    UnreadBorder='#756044'; TextForeground='#ECF2FC'; Accent='#72DFC2'; ScrollThumb='#53647D'; StatusIndicator='#64B5FF'
  }

  $workArea = [Windows.SystemParameters]::WorkArea
  # Screen rectangles use device pixels; window coordinates use WPF DIPs.
  $scaleX = [Windows.SystemParameters]::PrimaryScreenWidth / [Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
  $scaleY = [Windows.SystemParameters]::PrimaryScreenHeight / [Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
  $workAreas = @([Windows.Forms.Screen]::AllScreens | ForEach-Object {
    [Windows.Rect]::new($_.WorkingArea.Left * $scaleX, $_.WorkingArea.Top * $scaleY, $_.WorkingArea.Width * $scaleX, $_.WorkingArea.Height * $scaleY)
  })
  $script:window.Left = $workArea.Right - $script:window.Width - 24
  $script:window.Top = $workArea.Top + 80
  $preferencesPath = Join-Path $StateRoot 'preferences.json'
  $preferences = Read-Json $preferencesPath
  $script:window.Width = Saved-Dimension $preferences.width $script:window.Width $script:window.MinWidth ([Windows.SystemParameters]::VirtualScreenWidth)
  $script:window.Height = Saved-Dimension $preferences.height $script:window.Height 200 ([Windows.SystemParameters]::VirtualScreenHeight)
  $script:expandedHeight = $script:window.Height
  if ($preferences) {
    try {
      if ($null -ne $preferences.left -and $null -ne $preferences.top) {
        $left = [double]$preferences.left
        $top = [double]$preferences.top
        if (-not [double]::IsNaN($left) -and -not [double]::IsInfinity($left) -and -not [double]::IsNaN($top) -and -not [double]::IsInfinity($top)) {
          $position = Resolve-PanelPosition $left $top $script:window.Width $workAreas
          $script:window.Left = $position.left
          $script:window.Top = $position.top
        }
      }
    } catch { } # Invalid saved coordinates leave the default position intact.
    $script:window.Topmost = [bool]$preferences.topmost
    $script:collapsed = [bool]$preferences.collapsed
    if ($preferences.theme -eq 'night') { $script:theme = 'night' }
  }
  if ($PreviewTheme) { $script:theme = $PreviewTheme }
  $notificationPolicyPath = Join-Path $StateRoot 'notification-policy.json'
  $notificationPolicy = Read-Json $notificationPolicyPath
  if ($notificationPolicy) { $script:desktopEnabled = ($notificationPolicy.desktopEnabled -is [bool]) -and $notificationPolicy.desktopEnabled }
  function Save-Preferences {
    if ($script:geometryTimer) { $script:geometryTimer.Stop() }
    Write-Json $preferencesPath @{ left = $script:window.Left; top = $script:window.Top; width = $script:window.Width; height = $script:expandedHeight; topmost = $script:window.Topmost; collapsed = $script:collapsed; theme = $script:theme }
  }
  function Set-PanelStatus([string]$Text) { $script:window.ToolTip = $Text }
  function Compact-OwnerLabel([string]$Label) { return ($Label -replace '(?:\s*·\s*|^)ssh-remote\b', '').Trim() }
  function Resize-Panel([string]$Edges, [double]$Horizontal, [double]$Vertical) {
    $oldWidth = $script:window.Width
    $oldHeight = $script:window.Height
    $width = $oldWidth
    $height = $oldHeight
    if ($Edges.Contains('Left')) { $width -= $Horizontal }
    if ($Edges.Contains('Right')) { $width += $Horizontal }
    if (-not $script:collapsed) {
      if ($Edges.Contains('Top')) { $height -= $Vertical }
      if ($Edges.Contains('Bottom')) { $height += $Vertical }
    }
    $width = [Math]::Max($script:window.MinWidth, [Math]::Min($width, $script:window.MaxWidth))
    $height = [Math]::Max($script:window.MinHeight, [Math]::Min($height, $script:window.MaxHeight))
    if ($Edges.Contains('Left')) { $script:window.Left += $oldWidth - $width }
    if ($Edges.Contains('Top')) { $script:window.Top += $oldHeight - $height }
    $script:window.Width = $width
    $script:window.Height = $height
    if (-not $script:collapsed) { $script:expandedHeight = $height }
  }
  $script:geometryTimer = New-Object Windows.Threading.DispatcherTimer
  $script:geometryTimer.Interval = [TimeSpan]::FromMilliseconds(300)
  $script:geometryTimer.Add_Tick({ $script:geometryTimer.Stop(); try { Save-Preferences } catch { } })
  function Queue-GeometrySave {
    if ($script:rememberGeometry) { $script:geometryTimer.Stop(); $script:geometryTimer.Start() }
  }
  $script:window.Add_LocationChanged({ Queue-GeometrySave })
  $script:window.Add_SizeChanged({
    if (-not $script:collapsed -and $script:window.Height -ge 200) { $script:expandedHeight = $script:window.Height }
    Queue-GeometrySave
  })
  foreach ($name in $resizeNames) {
    $controls[$name].Add_DragDelta({ param($sender, $event) Resize-Panel $sender.Tag $event.HorizontalChange $event.VerticalChange; $event.Handled = $true })
    $controls[$name].Add_DragCompleted({ Save-Preferences; Write-Heartbeat })
  }
  function Write-Heartbeat {
    Write-Json (Join-Path $StateRoot 'panel-heartbeat.json') @{
      pid = $PID; updatedAt = (Now-Ms); visible = $script:window.IsVisible; version = '0.4.9'; theme = $script:theme; desktopEnabled = $script:desktopEnabled; controlId = $script:lastControl; left = $script:window.Left; top = $script:window.Top; width = $script:window.Width; height = $script:expandedHeight; runningCount = $script:runningCount; unreadCount = $script:unreadCount
    }
  }
  function Update-Chrome {
    $controls.Body.Visibility = if ($script:collapsed) { 'Collapsed' } else { 'Visible' }
    if ($script:geometryCollapsed -ne $script:collapsed) {
      if ($script:collapsed) { $script:window.MinHeight = 104; $script:window.Height = 104 }
      else { $script:window.MinHeight = 200; $script:window.Height = $script:expandedHeight }
      $script:geometryCollapsed = $script:collapsed
    }
    $controls.CollapseButton.Content = if ($script:collapsed) { '+' } else { '−' }
    $controls.PinButton.Background = if ($script:window.Topmost) { $script:window.Resources['PinBackground'] } else { $script:window.Resources['ButtonBackground'] }
    $controls.ThemeButton.Content = if ($script:theme -eq 'night') { [string][char]0xE708 } else { [string][char]0xE706 }
    $controls.ThemeButton.ToolTip = if ($script:theme -eq 'night') { '当前为夜晚配色，点击切换白天' } else { '当前为白天配色，点击切换夜晚' }
    $controls.ThemeButton.SetValue([Windows.Automation.AutomationProperties]::NameProperty, [string]$controls.ThemeButton.ToolTip)
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
  $controls.HideButton.Add_Click({ $script:window.Hide(); Write-Heartbeat; Save-Preferences })
  $controls.ThemeButton.Add_Click({
    $script:theme = if ($script:theme -eq 'day') { 'night' } else { 'day' }
    Apply-Theme; Save-Preferences; Refresh-Panel
  })
  $controls.NotificationButton.Add_Click({
    $script:desktopEnabled = -not $script:desktopEnabled
    Write-Json $notificationPolicyPath @{ desktopEnabled = $script:desktopEnabled; updatedAt = (Now-Ms) }
    Update-Chrome
  })

  function Text-Element([string]$Text, [string]$Color, [double]$Size = 12) {
    $textBlock = New-Object Windows.Controls.TextBlock
    $textBlock.Text = $Text
    $textBlock.Foreground = $Color
    $textBlock.FontSize = $Size
    $textBlock.TextWrapping = 'NoWrap'
    $textBlock.TextTrimming = 'CharacterEllipsis'
    return $textBlock
  }
  function Set-SpinnerMotion($Indicator, [bool]$Active) {
    if ($Active) {
      $animation = New-Object Windows.Media.Animation.DoubleAnimation
      $animation.From = 0
      $animation.To = 360
      $animation.Duration = [Windows.Duration]::new([TimeSpan]::FromMilliseconds(900))
      $animation.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever
      $Indicator.RenderTransform.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $animation)
    } else {
      $Indicator.RenderTransform.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $null)
    }
  }
  function Status-Indicator([bool]$Running) {
    if ($Running) {
      $indicator = New-Object Windows.Shapes.Path
      $indicator.Width = 12
      $indicator.Height = 12
      $indicator.Data = [Windows.Media.Geometry]::Parse('M 6,1 A 5,5 0 1 1 1,6')
      $indicator.Stroke = Theme-Color 'StatusIndicator'
      $indicator.StrokeThickness = 1.8
      $indicator.StrokeStartLineCap = 'Round'
      $indicator.StrokeEndLineCap = 'Round'
      $indicator.RenderTransform = [Windows.Media.RotateTransform]::new(0, 6, 6)
      # Native animation runs independently of log polling; stop it when hidden
      # or removed so old cards never keep animation clocks alive.
      $indicator.Add_IsVisibleChanged({ param($sender, $event) Set-SpinnerMotion $sender $sender.IsVisible })
      $indicator.Add_Unloaded({ param($sender, $event) Set-SpinnerMotion $sender $false })
      $indicator.ToolTip = '运行中'
    } else {
      $indicator = New-Object Windows.Shapes.Ellipse
      $indicator.Width = 7
      $indicator.Height = 7
      $indicator.Fill = Theme-Color 'StatusIndicator'
      $indicator.ToolTip = '待查看'
    }
    $indicator.Margin = '0,0,7,0'
    $indicator.VerticalAlignment = 'Center'
    return $indicator
  }
  function Get-VisibleRows($Rows, [double]$Now, [bool]$Stale) {
    foreach ($row in @($Rows)) {
      if (-not $row) { continue }
      $status = [string]$row.status
      if ($Stale -and $status -eq 'running') { $status = 'unknown' }
      # Older extension hosts may still publish replayed history as running.
      # Require live activity before presenting an active spinner.
      if ($status -eq 'running' -and $row.live -eq $false) { continue }
      # Filter the current turn's duration, not its last log activity. Keep the
      # stored session so a later completion still becomes an unread result.
      if ($status -eq 'running' -and $Now - [double]$row.startedAt -gt 500 * 60000) { continue }
      $unread = $row.unread -and -not [IO.File]::Exists((Join-Path $StateRoot ('read\' + $row.acknowledgement + '.json')))
      if ($status -eq 'running' -or $unread) {
        [pscustomobject]@{ row = $row; status = $status; unread = $unread }
      }
    }
  }
  function Mark-Read($Row) {
    if ([string]$Row.acknowledgement -notmatch '^[a-f0-9]{64}$') { return }
    Write-Json (Join-Path $StateRoot ('read\' + $Row.acknowledgement + '.json')) @{ at = (Now-Ms) }
    $script:lastModel = ''
  }
  function Request-Focus($Owner) {
    if (-not $Owner -or -not $Owner.online -or [string]$Owner.windowId -notmatch '^[a-f0-9-]+$') {
      Set-PanelStatus '窗口未连接'
      return
    }
    $commandFile = Join-Path $StateRoot ('commands\' + $Owner.windowId + '\' + [guid]::NewGuid().ToString() + '.json')
    Write-Json $commandFile @{ type = 'focus' }
    Set-PanelStatus ''
  }
  function Activate-Card($Card, [bool]$ShowMenu = $true) {
    if ($Card.Tag.stale) { Set-PanelStatus '窗口未连接'; return }
    $owners = @($Card.Tag.owners | Where-Object { $_.online })
    if ($owners.Count -le 1) { Request-Focus ($owners | Select-Object -First 1); return }
    $menu = New-Object Windows.Controls.ContextMenu
    foreach ($owner in $owners) {
      $item = New-Object Windows.Controls.MenuItem
      $item.Header = (Compact-OwnerLabel $owner.label) + ' · ' + ([string]$owner.windowId).Substring(0, 4)
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
      if ($control.type -eq 'hide') { $script:requestedVisible = $false; $script:window.Hide() }
      if ($control.type -eq 'show') { $script:requestedVisible = $true; $script:window.Show() }
    }
    $response = Read-Json (Join-Path $StateRoot 'response.json')
    if ($response -and [double]$response.at -gt $script:lastResponse) {
      $script:lastResponse = [double]$response.at
      if ([string]$response.message -match '未能|无法|failed') { Set-PanelStatus '无法切换窗口' }
      else { Set-PanelStatus '' }
    }
    $modelFile = Join-Path $StateRoot 'model.json'
    try { $json = Read-TextShared $modelFile } catch { return }
    $model = $json | ConvertFrom-Json
    $policy = Read-Json $notificationPolicyPath
    $script:desktopEnabled = $policy -and ($policy.desktopEnabled -is [bool]) -and $policy.desktopEnabled
    Update-Chrome
    $now = Now-Ms
    if ($now - [double]$model.updatedAt -lt 15000) { $script:lastLiveAt = $now }
    $stale = $now - [double]$model.updatedAt -ge 15000
    # The same filtered rows drive the list and counts, including when a turn
    # crosses 500 minutes without receiving another log update.
    $visibleRows = @(Get-VisibleRows $model.rows $now $stale)
    $signature = ($visibleRows | ConvertTo-Json -Depth 18 -Compress) + ':' + $stale + ':' + [Math]::Floor($now / 60000) + ':' + $script:theme
    $running = 0
    $pending = 0
    foreach ($visible in $visibleRows) {
      if ($visible.status -eq 'running') { $running++ }
      if ($visible.unread) { $pending++ }
    }
    $controls.RunningCount.Text = '运行中  ' + $running
    $controls.UnreadCount.Text = '待查看  ' + $pending
    $script:runningCount = $running
    $script:unreadCount = $pending
    $controls.ConnectionDot.Fill = if ($stale) { '#88909A' } else { Theme-Color 'Accent' }
    $controls.ConnectionDot.ToolTip = if ($stale) { '已断开' } else { '已连接' }
    if ($signature -eq $script:lastModel) { return }
    $script:lastModel = $signature
    $scrollOffset = $controls.SessionScroll.VerticalOffset
    $controls.SessionList.Children.Clear()
    $script:cards = @()
    foreach ($visible in $visibleRows) {
      $row = $visible.row
      $unread = $visible.unread
      $status = $visible.status
      $statusLabel = switch ($status) {
        'running' { '运行中' }
        'completed' { '待查看' }
        'failed' { '出错 · 待查看' }
        default { '状态待确认' }
      }
      $color = if ($unread) { Theme-Color 'UnreadForeground' } else { Theme-Color 'RunningForeground' }
      $card = New-Object Windows.Controls.Border
      $card.Background = Theme-Color 'CardBackground'
      $card.BorderBrush = if ($unread) { Theme-Color 'UnreadBorder' } else { Theme-Color 'CardBorder' }
      $card.BorderThickness = '1'
      $card.CornerRadius = '7'
      $card.Padding = '8,8'
      $card.Margin = '0,0,0,6'
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
      $statusLine = New-Object Windows.Controls.Grid
      $statusLine.ColumnDefinitions.Add([Windows.Controls.ColumnDefinition]::new())
      $statusLine.ColumnDefinitions[0].Width = 'Auto'
      $statusLine.ColumnDefinitions.Add([Windows.Controls.ColumnDefinition]::new())
      $null = $statusLine.Children.Add((Status-Indicator ($status -eq 'running')))
      $statusText = Text-Element ($provider + ' · ' + $statusLabel) $color 10
      [Windows.Controls.Grid]::SetColumn($statusText, 1)
      $null = $statusLine.Children.Add($statusText)
      $null = $stack.Children.Add($statusLine)
      $title = if ($row.title) { [string]$row.title } else { '会话 ' + ([string]$row.sessionId).Substring(0, [Math]::Min(8, ([string]$row.sessionId).Length)) }
      $heading = Text-Element $title (Theme-Color 'TextForeground') 12
      $heading.Margin = '0,5,0,5'
      $heading.ToolTip = $title
      $null = $stack.Children.Add($heading)
      $owners = @($row.owners)
      $owner = $owners | Where-Object { $_.online } | Select-Object -First 1
      $label = if ($owner) { Compact-OwnerLabel $owner.label } elseif ($owners.Count) { (Compact-OwnerLabel $owners[0].label) + ' · 已断连' } else { '未知窗口' }
      $timeLabel = if ($status -eq 'running') {
        '运行 ' + [Math]::Max(0, [Math]::Floor(($now - [double]$row.startedAt) / 60000)) + ' 分钟'
      } else { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$row.updatedAt).ToLocalTime().ToString('MM-dd HH:mm') }
      $metadata = New-Object Windows.Controls.Grid
      $metadata.ColumnDefinitions.Add([Windows.Controls.ColumnDefinition]::new())
      $metadata.ColumnDefinitions.Add([Windows.Controls.ColumnDefinition]::new())
      $metadata.ColumnDefinitions[1].Width = 'Auto'
      $detail = New-Object Windows.Controls.StackPanel
      $ownerText = Text-Element $label (Theme-Color 'MutedForeground') 9
      $ownerText.ToolTip = $label
      $null = $detail.Children.Add($ownerText)
      $null = $detail.Children.Add((Text-Element $timeLabel (Theme-Color 'MutedForeground') 9))
      $null = $metadata.Children.Add($detail)
      if ($unread) {
        $read = New-Object Windows.Controls.Button
        $read.Content = [string][char]0xE73E
        $read.FontFamily = 'Segoe MDL2 Assets'
        $read.FontSize = 11
        $read.Width = 24; $read.Height = 24
        $read.Margin = '4,0,0,0'; $read.Padding = '4'
        $read.ToolTip = '标记已查看'
        $read.SetValue([Windows.Automation.AutomationProperties]::NameProperty, '标记已查看')
        [Windows.Controls.Grid]::SetColumn($read, 1)
        $read.Tag = $row
        $read.Add_Click({ param($sender, $event) $event.Handled = $true; Mark-Read $sender.Tag; Refresh-Panel })
        $null = $metadata.Children.Add($read)
        $card.Tag.readButton = $read
      }
      $null = $stack.Children.Add($metadata)
      $null = $controls.SessionList.Children.Add($card)
      $script:cards += $card
    }
    if ($controls.SessionList.Children.Count -eq 0) {
      $empty = Text-Element '暂无会话' (Theme-Color 'MutedForeground') 11
      $empty.Margin = '4,18,4,18'
      $null = $controls.SessionList.Children.Add($empty)
    }
    $controls.SessionScroll.ScrollToVerticalOffset($scrollOffset)
  }
  Refresh-Panel

  if ($SelfTest) {
    if ($script:window.Width -ne 205 -or $script:window.Height -ne 360) { throw 'Default geometry must be 205 x 360 DIP.' }
    if ($script:window.FindName('Footer') -or $script:window.FindName('ConnectionText')) { throw 'The compact layout must omit persistent explanation text.' }
    if ((Compact-OwnerLabel 'DNAKit [SSH: test] · ssh-remote') -ne 'DNAKit [SSH: test]') { throw 'SSH implementation labels must not appear.' }
    if ((Saved-Dimension $null 205 180 4000) -ne 205 -or (Saved-Dimension 'invalid' 205 180 4000) -ne 205) { throw 'Legacy or invalid geometry must use compact defaults.' }
    $geometryLeft = $script:window.Left; $geometryTop = $script:window.Top
    foreach ($name in $resizeNames) { if ($controls[$name] -isnot [Windows.Controls.Primitives.Thumb]) { throw ('Missing resize handle: ' + $name) } }
    $resizeEvent = [Windows.Controls.Primitives.DragDeltaEventArgs]::new(40, 60)
    $resizeEvent.RoutedEvent = [Windows.Controls.Primitives.Thumb]::DragDeltaEvent
    $controls.ResizeSE.RaiseEvent($resizeEvent)
    $resizeDone = [Windows.Controls.Primitives.DragCompletedEventArgs]::new(40, 60, $false)
    $resizeDone.RoutedEvent = [Windows.Controls.Primitives.Thumb]::DragCompletedEvent
    $controls.ResizeSE.RaiseEvent($resizeDone)
    $savedGeometry = Read-Json $preferencesPath
    if ($script:window.Width -ne 245 -or $script:window.Height -ne 420 -or $savedGeometry.width -ne 245 -or $savedGeometry.height -ne 420) { throw 'Corner resizing must persist both dimensions.' }
    $controls.CollapseButton.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Button]::ClickEvent))
    if ((Read-Json $preferencesPath).height -ne 420 -or $script:window.Height -ne 104) { throw 'Collapsing must preserve the expanded height.' }
    $controls.CollapseButton.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Button]::ClickEvent))
    if ($script:window.Height -ne 420) { throw 'Expanding must restore the resized height.' }
    $rightEdge = $script:window.Left + $script:window.Width
    $bottomEdge = $script:window.Top + $script:window.Height
    Resize-Panel 'TopLeft' 10000 10000
    if ($script:window.Width -ne 180 -or $script:window.Height -ne 200 -or $script:window.Left + $script:window.Width -ne $rightEdge -or $script:window.Top + $script:window.Height -ne $bottomEdge) { throw 'Minimum-size constraints must preserve the opposite resize edge.' }
    $script:window.Left = $geometryLeft; $script:window.Top = $geometryTop
    $script:window.Width = 205; $script:window.Height = 360; $script:expandedHeight = 360
    Save-Preferences
    $primaryArea = [Windows.Rect]::new(0, 0, 2560, 1392)
    $secondaryArea = [Windows.Rect]::new(2560, 0, 1440, 2512)
    $negativeArea = [Windows.Rect]::new(-1920, -200, 1920, 1080)
    foreach ($point in @(@(500, 200), @(2584, 1212), @(-1800, -100))) {
      $position = Resolve-PanelPosition $point[0] $point[1] 410 @($primaryArea, $secondaryArea, $negativeArea)
      if ($position.left -ne $point[0] -or $position.top -ne $point[1]) { throw 'Positions on primary, secondary and negative-origin screens must be preserved exactly.' }
    }
    $recovered = Resolve-PanelPosition 3000 1800 410 @($primaryArea)
    if ($recovered.left -lt 0 -or $recovered.left -gt 2150 -or $recovered.top -lt 0 -or $recovered.top -gt 1232) { throw 'A disconnected display must recover onto a visible screen.' }
    $originalLeft = $script:window.Left; $originalTop = $script:window.Top
    $script:window.Left = 2584; $script:window.Top = 1212
    Save-Preferences
    $savedPosition = Read-Json $preferencesPath
    $restoredPosition = Resolve-PanelPosition $savedPosition.left $savedPosition.top 410 @($primaryArea, $secondaryArea)
    if ($restoredPosition.left -ne 2584 -or $restoredPosition.top -ne 1212) { throw 'Saved coordinates must survive a disk round trip on a secondary screen.' }
    $script:window.Left = $originalLeft; $script:window.Top = $originalTop
    Save-Preferences
    if ($script:cards.Count -ne 2) { throw 'Panel must show only running and unread fixture rows.' }
    if ($controls.RunningCount.Text -ne '运行中  1' -or $controls.UnreadCount.Text -ne '待查看  1') { throw 'Hidden long-running rows must not contribute to counts.' }
    $historyOnly = [pscustomobject]@{ status = 'running'; live = $false; unread = $false; startedAt = (Now-Ms) }
    if (@(Get-VisibleRows @($historyOnly) (Now-Ms) $false).Count -ne 0) { throw 'Baseline history from older extension hosts must not show an active spinner.' }
    $dot = $script:cards[0].Child.Children[0].Children[0]
    $spinner = $script:cards[1].Child.Children[0].Children[0]
    if ($dot -isnot [Windows.Shapes.Ellipse] -or $dot.Fill.ToString() -ne '#FF1676D2') { throw 'Unread results must have a blue dot.' }
    if ($spinner -isnot [Windows.Shapes.Path]) { throw 'Running cards must have a spinner.' }
    Set-SpinnerMotion $spinner $true
    if (-not $spinner.RenderTransform.HasAnimatedProperties) { throw 'The spinner must animate continuously.' }
    Set-SpinnerMotion $spinner $false
    if ($spinner.RenderTransform.HasAnimatedProperties) { throw 'Hidden/unloaded spinners must release their animation clocks.' }
    $boundary = [pscustomobject]@{ status = 'running'; startedAt = 1000000; unread = $false }
    $cutoff = $boundary.startedAt + 500 * 60000
    if (@(Get-VisibleRows @($boundary) ($cutoff - 1) $false).Count -ne 1) { throw 'A turn below 500 minutes must remain visible.' }
    if (@(Get-VisibleRows @($boundary) $cutoff $false).Count -ne 1) { throw 'Exactly 500 minutes must remain visible.' }
    if (@(Get-VisibleRows @($boundary) ($cutoff + 1) $false).Count -ne 0) { throw 'A turn exceeding 500 minutes must be hidden.' }
    $boundary.status = 'completed'; $boundary.unread = $true
    if (@(Get-VisibleRows @($boundary) ($cutoff + 1) $false).Count -ne 1) { throw 'Long-running completions must remain available for review.' }
    $boundary.status = 'running'; $boundary.unread = $false; $boundary.startedAt = $cutoff
    if (@(Get-VisibleRows @($boundary) ($cutoff + 1) $false).Count -ne 1) { throw 'A fresh turn must be visible after an old turn was hidden.' }
    if ($script:theme -ne 'day') { throw 'The default theme must be day.' }
    if ($script:desktopEnabled) { throw 'Desktop notifications must default off, even with a legacy model.' }
    foreach ($key in @('TitleForeground','MutedForeground','ButtonForeground','RunningForeground','UnreadForeground','TextForeground')) {
      if ((Theme-Color $key) -ne '#FF000000') { throw ('Day text must be pure black: ' + $key) }
    }
    if ($controls.ThemeButton.Content -ne [string][char]0xE706) { throw 'Day theme button must show a sun symbol.' }
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
    if ($script:theme -ne 'night' -or (Read-Json $preferencesPath).theme -ne 'night' -or $controls.ThemeButton.Content -ne [string][char]0xE708) { throw 'Night theme and moon symbol must persist.' }
    $controls.ThemeButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ($script:theme -ne 'day') { throw 'Day theme toggle failed.' }
    $controls.NotificationButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ((Read-Json $notificationPolicyPath).desktopEnabled -ne $true) { throw 'Desktop notification enable failed.' }
    $controls.NotificationButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if ((Read-Json $notificationPolicyPath).desktopEnabled -ne $false) { throw 'Desktop notification mute failed.' }
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
    $script:cards[0].Tag.readButton.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Button]::ClickEvent)))
    if (-not [IO.File]::Exists((Join-Path $StateRoot ('read\' + $pendingRow.acknowledgement + '.json')))) { throw 'Read acknowledgement failed' }
    if ($script:cards.Count -ne 1 -or $controls.UnreadCount.Text -ne '待查看  0') { throw 'Reviewed results must disappear immediately.' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $StateRoot ('commands\' + $pendingRow.owners[0].windowId)) -Filter '*.json').Count -ne $focusFiles.Count) { throw 'Marking read must not activate a window.' }
    Remove-Item -LiteralPath (Join-Path $StateRoot ('read\' + $pendingRow.acknowledgement + '.json'))
    # A rapid show/hide pair must leave the startup window hidden, and the
    # heartbeat must acknowledge the final request so all status bars agree.
    Write-Json (Join-Path $StateRoot 'control.json') @{ type = 'show'; id = 'test-show' }
    Write-Json (Join-Path $StateRoot 'control.json') @{ type = 'hide'; id = 'test-hide' }
    Refresh-Panel
    Write-Heartbeat
    $health = Read-Json (Join-Path $StateRoot 'panel-heartbeat.json')
    if ($health.pid -ne $PID -or $health.version -ne '0.4.9' -or $health.width -ne 205 -or $health.height -ne 360) { throw 'Panel heartbeat geometry failed' }
    if ($health.controlId -ne 'test-hide' -or $health.visible -or $script:requestedVisible) { throw 'Visibility acknowledgement failed' }
    # A reader must not block replacement of a snapshot on Windows.
    $probe = Join-Path $StateRoot 'shared-read-test.json'
    Write-Json $probe @{ revision = 1 }
    $probeStream = [IO.File]::Open($probe, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try { Write-Json $probe @{ revision = 2 } } finally { $probeStream.Dispose() }
    if ((Read-Json $probe).revision -ne 2) { throw 'Atomic replacement during shared read failed' }
    $script:lastModel = ''
    Refresh-Panel
    foreach ($card in $script:cards) {
      if ($card.Child.Children[1].TextWrapping -ne 'NoWrap' -or $card.Child.Children[1].TextTrimming -ne 'CharacterEllipsis') { throw 'Conversation titles must be one line with ellipsis.' }
    }
    [Console]::Out.WriteLine('self-test=passed;cards=' + $script:cards.Count)
  }
  if ($PreviewPath) {
    # Render the actual WPF controls offscreen, without opening a desktop window.
    $content = $script:window.Content
    $content.Measure((New-Object Windows.Size $script:window.Width, $script:window.Height))
    $content.Arrange((New-Object Windows.Rect 0, 0, $script:window.Width, $script:window.Height))
    $content.UpdateLayout()
    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap ([int][Math]::Ceiling($content.ActualWidth)), ([int][Math]::Ceiling($content.ActualHeight)), 96, 96, ([Windows.Media.PixelFormats]::Pbgra32)
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
      Set-PanelStatus '读取失败，重试中'
    }
  })
  $script:window.Add_Closed({ $script:timer.Stop(); Save-Preferences; [Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() })
  $script:timer.Start()
  $script:rememberGeometry = $true
  if ($script:requestedVisible) { $script:window.Show() }
  Write-Heartbeat
  try { Save-Preferences } catch { Set-PanelStatus '设置保存失败' }
  # Unlike ShowDialog, a dispatcher loop continues while the window is hidden.
  [Windows.Threading.Dispatcher]::Run()
} catch {
  try { [IO.File]::WriteAllText((Join-Path $StateRoot 'panel-error.log'), ($_ | Out-String)) } catch {}
  throw
} finally {
  if ($script:geometryTimer) { $script:geometryTimer.Stop() }
  if ($script:timer) { $script:timer.Stop() }
  if ($ownsMutex) {
    $heartbeatFile = Join-Path $StateRoot 'panel-heartbeat.json'
    try { if ((Read-Json $heartbeatFile).pid -eq $PID) { [IO.File]::Delete($heartbeatFile) } } catch {}
  }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
