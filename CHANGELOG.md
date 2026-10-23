# Changelog / 更新日志

All notable changes to Notifyer are documented in this file.

Notifyer 的重要变更都会记录在此文件中。

## 0.4.20 - 2026-10-23

### Changed / 调整

- Open clicked Codex conversations in the existing Codex sidebar using its session-specific URI handler, rather than creating a conversation editor tab. Resolve the callback through VS Code for the originating window and preserve its URI unchanged.
- 点击 Codex 卡片时，改用带会话 ID 的 URI 入口，在现有 Codex 侧边栏切换并打开对应聊天，不再新开会话编辑器标签。通过 VS Code 解析对应窗口的回调链接，并原样传递。
- Keep source-environment and SSH-authority checks. Missing selectors and rejected links retain reminders; accepted URL delivery alone never acknowledges a result. Confirmed native read receipts remain scoped to the exact pending turn.
- 保留来源环境及 SSH 主机核验。入口不可用、链接被拒绝时保留提醒；仅链接已发送不算已查看，确认后的原生已读回执仍仅对应具体待查看轮次。

## 0.4.19 - 2026-10-23

### Fixed / 修复

- Synchronize Codex sidebar review state using the provider's per-conversation unread-to-read transitions, alongside existing custom-editor URI selection. Sidebar conversations do not appear as editor tabs and were previously missed.
- 补上 Codex 侧边栏的按会话已读同步；侧边栏对话不属于编辑区标签，之前仅核对自定义编辑器 URI 时会漏掉。
- Capture the pending result's provider, session, turn and completion status before a read transition. Other conversations, newer results, ambiguous sources, unavailable state and an already-empty initial unread list do not acknowledge a result.
- 已读变化前保存待查看结果的提供方、会话、轮次及完成状态；其他对话、新结果、来源不唯一、状态不可用或初始未读列表为空时，均不自动清除。
- Read only the required Codex namespace from the current profile's VS Code state database. Diagnostics now report native read-state availability and the last reviewed conversation/source.
- 仅读取当前用户配置下 VS Code 状态库所需的 Codex 命名空间；诊断补充原生已读状态是否可用，以及最近同步的会话及来源。

## 0.4.18 - 2026-10-23

### Fixed / 修复

- Recognize mounted remote home paths such as `/data/home/user` and `/mnt/data/home/user` when locating Codex and Claude session directories.
- 查找 Codex／Claude 会话目录时，支持 `/data/home/user`、`/mnt/data/home/user` 等挂载目录中的远程用户主目录。
- Discover Codex logs by recent modification time throughout the sessions tree. A conversation resumed from an older date directory is no longer missed because of its creation date.
- Codex 改为按最近修改时间发现会话日志，不再因对话创建日期较早而漏掉继续使用的旧会话。
- Inspect inactive files through metadata only, with bounded parallel requests. Remember their historical byte boundaries so later resumes process appended activity without replaying historical completions as new reminders; preserve silent startup baselines.
- 非活跃文件仅读取元数据，并限制并发请求。记录历史内容边界，旧对话恢复时仅把追加活动作为新内容，避免补发旧完成提醒；首次扫描仍保持静默。

## 0.4.17 - 2026-10-23

### Fixed / 修复

- Fix floating-card navigation when Notifyer runs locally and Claude or Codex runs in the remote extension host. The local extension registry can omit remote providers; use their globally registered session command/editor selector instead of returning after window focus.
- 修复 Notifyer 在本机、Claude／Codex 在远程扩展宿主时的卡片跳转。本机扩展列表可能不包含远程提供方，现改用全局注册的指定会话命令／编辑器选择器，避免只返回项目窗口。
- Preserve source-environment checks and exact-session verification before acknowledging the clicked result. A different tab, unavailable selector or unconfirmed identity keeps its pending reminder.
- 保留来源环境检查与具体会话核验；选中其他标签、命令不可用或身份无法确认时，继续保留待查看。
- Include live selection and navigation diagnostics in each window snapshot, recording command availability and the last verification phase.
- 各窗口快照补充实时会话选中与跳转诊断，记录命令可用性及最后核验阶段。

## 0.4.16 - 2026-10-23

### Fixed / 修复

- Synchronize review state when users select completed conversations directly inside VS Code. Earlier versions handled floating-card navigation only.
- 补上直接在 VS Code 内选中已完成对话的已查看同步；此前只处理桌面卡片跳转。
- Codex uses the active conversation editor URI. Claude cross-checks persisted session IDs, current tab positions/layout and provider bindings, and observes provider-native per-session read transitions. Already-active Claude editors can now be confirmed.
- Codex 核对活动编辑器 URI；Claude 交叉核对保存的会话 ID、当前标签顺序／布局及提供方绑定，同时同步按会话记录的原生已读变化，支持确认原本已激活的标签页。
- Read only the current profile/workspace's required VS Code namespaces using readonly SQLite. Missing/corrupt/ambiguous state stays unread; source databases, messages and logs are never modified.
- 只读访问当前用户配置及工作区所需的 VS Code 状态；缺失、损坏或无法确认的身份继续保留待查看，不改写源存储、消息或日志。
- Retain other conversations, new turns and revised completion results. Background tab changes alone never count as viewing. Correct remote Claude navigation when extension-host metadata describes the local UI, and report active extension version/selection diagnostics.
- 保留其他对话、新轮次及更新后的结果；后台标签变化不算查看。修正扩展宿主信息指向本机 UI 时的远程 Claude 跳转，并补充活动扩展版本及会话选中诊断。

## 0.4.15 - 2026-10-23

### Changed / 调整

- Lead each floating card with the real project name in bold, at the body font size. Running projects use blue and unread projects use yellow in both themes.
- 卡片首行改为真实项目名并加粗，字号与正文相同；运行中显示蓝色，待查看显示黄色，昼夜配色均支持。
- Move provider/status text below the prompt in gray, two font sizes smaller than the body. Font controls preserve the size difference; long project names stay on one line with ellipsis.
- 提供方及状态移至正文下方，使用灰色，比正文小 2 号；调整字号时保持差值，长项目名单行省略。
- Updated native layout checks and day/night previews, including a long project name. Session navigation and review behavior are unchanged.
- 更新原生布局验证及昼夜预览，覆盖较长项目名；会话跳转及已查看逻辑保持不变。

## 0.4.14 - 2026-10-23

### Changed / 调整

- Floating-card clicks now carry the exact provider, session ID, turn ID and acknowledgement to the selected VS Code window, then use the provider's session selector instead of window activation alone.
- 点击悬浮卡片会携带具体提供方、会话 ID、轮次及已查看标识，返回所选窗口后定位对应对话。
- Confirmed selection acknowledges only the clicked completed result. Other chats in the same window, later turns, unsuccessful navigation and window-only focus stay unread. Rapid clicks use the latest request.
- 确认选中后只移除所点击完成轮次的待查看；同窗口其他对话、后续新结果、跳转失败或只返回窗口时仍保留提醒，快速连续点击以最后一次为准。
- Codex checks the active conversation editor URI. Claude uses its session-ID command and requires a selected Claude editor change; its sidebar/already-active surfaces retain manual review when identity cannot be confirmed. Manual checkmarks remain available.
- Codex 核对活动会话编辑器 URI；Claude 使用带会话 ID 的打开命令并要求选中 Claude 编辑器发生变化，无法确认的侧边栏／原本已激活布局保留手动标记。

## 0.4.13 - 2026-10-22

### Fixed / 修复

- Clean conversation titles before truncating: remove pasted-content wrappers, image/file markers, image paths, dimensions, coordinate hints and attachment scaffolding while preserving readable text.
- 标题先清理再截取，去除粘贴内容包装标签、图片／文件标记、图片路径、尺寸、坐标提示及附件说明，保留可读正文。
- Image-only and file-only messages use readable placeholders. Existing cached titles are cleaned by the native panel immediately; future Codex/Claude titles are cleaned during activity parsing.
- 纯图片／纯附件消息使用简短占位文字；原生窗口立即清理旧缓存标题，后续 Codex／Claude 标题在采集时清理。
- Added shared regression fixtures for parser/native parity and multimodal title handling; original session logs and messages remain untouched.
- 新增采集与原生窗口共用的清理样例及多模态标题回归验证，不修改原始日志和消息。

## 0.4.12 - 2026-10-22

### Changed / 调整

- The red detail line now shows only the project name, removing SSH/remote suffixes, runtime and completion timestamps while retaining the chosen font and color.
- 红色详情仅显示项目名，删除 SSH／远程后缀、运行时长和完成时间，保留已选择的字号和颜色。
- Session timing remains available internally for running-state and timeout filtering.
- 会话时间仍在内部用于运行状态及超时过滤。

## 0.4.11 - 2026-10-22

### Added / 新增

- Added **A− / A+** header controls for immediate font adjustment, saving the selected size across reopening and restarting. The default conversation font increases from 12 to 14 DIP; titles, red metadata, statuses and counts adjust together.
- 顶部新增 **A− / A+** 字号按钮，点击立即调整并保存，重开及重启后恢复。默认会话字号从 12 增至 14，标题、红色详情、状态及计数同步调整。
- Enforced 10–24 DIP limits, disabled controls at the boundaries and allowed extra collapsed height for larger text. Native checks cover both buttons, immediate styling, persistence and fresh-process font restoration.
- 字号限制在 10–24 DIP，到达边界时禁用对应按钮；大字下折叠高度自适应。原生验证覆盖增减按钮、即时样式、保存及新进程恢复字号。

## 0.4.10 - 2026-10-22

### Changed / 调整

- Set the default window size to 280 × 440 DIP and default theme to night, while preserving saved geometry and explicit day/night choices.
- 默认大小调整为 280 × 440 DIP，默认夜晚配色，保留已保存的大小、位置及手动昼夜选择。
- Project names and runtime now match the conversation title's font size and use red in both palettes.
- 项目名和运行时间改为与会话标题相同字号，在昼夜配色下均以红色显示。

## 0.4.9 - 2026-10-22

### Changed / 调整

- Halved the default panel width to 205 DIP with compact header controls and one-line ellipsized titles. Removed persistent connection/focus explanations and redundant SSH environment labels; marking reviewed uses a compact checkmark button.
- 默认宽度减半至 205 DIP，顶部控件紧凑排列，标题单行省略；移除常驻连接／跳转说明及重复的 SSH 环境标签，以勾选按钮标记已查看。
- Added edge/corner resizing and automatic persistence of width, expanded height and position. Collapsing preserves the expanded geometry; legacy preferences adopt compact dimensions while retaining the saved location.
- 支持拖动四边和四角缩放，自动保存宽度、展开高度及位置；折叠保留展开尺寸，旧偏好采用紧凑默认大小并保留位置。
- Native checks cover resize gestures, minimum-size anchoring, collapse/expand, one-line trimming and exact size/position restoration in a fresh helper process.
- 原生验证覆盖拖动缩放、最小尺寸锚点、折叠展开、单行省略及新进程恢复相同大小和位置。

## 0.4.8 - 2026-10-22

### Fixed / 修复

- Historical scans now reconcile each file's final state atomically, with local observation order separate from event timestamps. Older completion timestamps can replace cached running states without replaying earlier turns or losing persisted unread results.
- 历史扫描只提交每个文件的最终状态，分离本机观测顺序与日志时间；修复旧“运行中”缓存覆盖实际完成结果，并保留已有待查看状态。
- History alone no longer proves that a conversation is running; live activity must resume before it appears. Native filtering also hides baseline-only rows published by older extension hosts.
- 仅有历史记录不再判断为正在运行，收到新的实时活动后才显示；原生窗口也会隐藏旧扩展进程上报的纯历史运行记录。
- Claude API errors, interruption markers and truncated/terminal response stop reasons leave the running list without generating a successful completion. Real resumed activity can re-enter it. Late Codex errors cannot revive an aborted turn.
- Claude API 连接错误、中断标记及截断等停止状态退出运行列表，不生成成功完成记录；恢复真实活动后可重新显示。Codex 中止后迟到的错误不会让会话重新运行。
- Retained the 500-minute display limit and quiet timeout as fallback rules, and added regression coverage for history reconciliation and interrupted streams.
- 保留 500 分钟显示上限与日志静默兜底，并补充历史状态校正及断流回归验证。

## 0.4.7 - 2026-10-22

### Fixed / 修复

- Restore the saved panel position on any connected monitor, including secondary screens and negative desktop coordinates, rather than clamping it to the primary monitor. If the saved header is no longer reachable, recover onto the nearest available display.
- 恢复上次拖放的位置时支持副屏和负坐标桌面，不再强制限制到主屏；原屏幕断开或标题栏不可见时，回到最近的可用屏幕。
- Added native position restoration and preference round-trip checks, with current coordinates available in the helper heartbeat for diagnostics.
- 新增原生位置恢复、偏好文件保存读取验证，并在进程心跳中记录当前位置以便诊断。

## 0.4.6 - 2026-10-22

### Changed / 调整

- The conversation list now opens at a fixed height of approximately three cards, preserving empty space for fewer conversations and scrolling for additional ones.
- 中间会话列表默认固定为约 3 张卡片的高度，少量会话保留空白，更多会话滚动查看。

## 0.4.5 - 2026-10-22

### Changed / 调整

- Running turns exceeding 500 minutes are hidden from both the panel list and running count, even without new log activity. Later completions remain available for review and new turns are timed separately.
- 本轮运行超过 500 分钟后从悬浮窗列表及运行中计数隐藏，无需等待新日志；后续完成仍可进入待查看，新一轮重新计时。
- Added a continuously rotating indicator before running cards and a blue dot before unread results in both themes. Animations stop when cards are hidden or unloaded.
- 运行中卡片前新增持续转圈动画，待查看结果前新增蓝点，适配昼夜配色；卡片隐藏或移除时停止动画。

## 0.4.4 - 2026-10-22

### Added / 新增

- Added a right-aligned Notifyer status bar entry in VS Code to show/hide the Windows desktop panel with one click, with synchronized eye icons, tooltips and keyboard-accessible command.
- 新增 VS Code 底部右侧 Notifyer 入口，一键显示／隐藏 Windows 桌面悬浮窗；眼睛图标和提示跨窗口同步，并提供可通过键盘调用的切换命令。
- Pending visibility requests and helper acknowledgements keep rapid clicks and native title-bar hiding consistent. Startup respects a hide request made while the helper is launching.
- 显隐请求及进程回执确保连续点击与小窗右上角隐藏后的状态一致，进程启动期间的隐藏操作不会被启动逻辑覆盖。

## 0.4.3 - 2026-10-22

### Changed / 调整

- Replaced theme text with sun/moon symbols and made all daytime text pure black.
- 主题按钮改为太阳／月亮符号，白天文字统一为纯黑。
- Desktop notifications now default to off when preferences are missing or invalid; explicit saved choices persist. Added a cross-platform command to toggle desktop notifications without the Windows panel.
- 桌面通知在偏好缺失或无效时默认关闭，保留手动保存的选择；新增跨平台通知开关命令，无需悬浮窗也可开启。

## 0.4.2 - 2026-10-22

### Changed / 调整

- Added persistent day/night themes (day by default), themed controls and scrollbars, and a shared desktop-notification toggle that preserves unread tracking and configured editor notifications.
- 新增默认白天的昼夜配色、随主题切换的控件与滚动条，以及跨窗口共享的桌面通知开关；关闭桌面通知仍保留未读结果和已配置的编辑器通知。
- Removed the subtitle, reviewed history and unknown states from the visible list. Entire cards now activate matching windows, with keyboard support and a chooser for ambiguous matches; marking reviewed removes a card without changing windows.
- 删除副标题，列表仅显示运行中与待查看；整张卡片支持点击或键盘切回窗口，同项目多窗口可选择；标记已查看后立即移除且不切换窗口。

## 0.4.1 - 2026-10-22

### Fixed / 修复

- Added floating-helper heartbeats and automatic restart with backoff, capturing startup errors and exit codes in diagnostics. Hidden windows remain hidden; manual show reports startup failures.
- 新增悬浮窗进程心跳、退避重启和启动错误/退出码诊断；主动隐藏的小窗不会被自动重启逻辑重新打开，手动显示失败时提供诊断入口。
- Native snapshot reads now permit atomic file replacement, preventing Windows sharing violations; snapshot-write failures no longer prevent initial UI launch.
- 原生窗口读取状态时允许文件原子替换，避免 Windows 文件占用；临时状态写入失败不再跳过窗口启动。

## 0.4.0 - 2026-10-22

### Added / 新增

- Shared native Windows floating window for the latest Codex / Claude conversation turns across VS Code windows in the same profile. Supports pinning, dragging, collapsing, hiding/reopening and matching-window activation.
- 新增跨 VS Code 窗口的 Windows 原生会话悬浮窗，支持置顶、拖动、折叠、隐藏和恢复，以及返回匹配窗口。
- Persistent shared review acknowledgements, silent historical baselines, session deduplication, and unconfirmed status after disconnection, aborts or prolonged log silence. Multiple matching project windows require explicit selection.
- 待查看结果及已查看标记持久化并跨窗口共享；支持历史基线静默、多窗口去重，以及断连、中止或长时间无日志时的待确认状态。同项目多窗口时提供窗口选择。
- Unit coverage for activity parsing and shared state, plus offscreen Windows WPF control/IPC validation and preview generation.
- 新增状态解析及共享存储测试，以及 Windows WPF 控件、IPC 和界面渲染验证。

## 0.3.6 - 2026-09-15

### Fixed / 修复

- Initial Codex and Claude scans now establish a strictly silent baseline by default instead of using completion timestamps, preventing historical notifications caused by clock differences between local and remote environments.
- Codex 与 Claude 首次扫描现在默认严格静默建立基线，不再依据完成时间戳判断，从而避免本机与远程环境时钟差异导致历史通知集中弹出。
- Completion events are claimed atomically in shared extension storage, so the same task can produce only one notification across multiple VS Code windows.
- 完成事件现在会在插件全局存储中进行原子认领，因此多个 VS Code 窗口同时运行时，同一个任务只会通知一次。
- Session files discovered after the initial baseline remain eligible for normal new-task notifications.
- 首次基线建立后新发现的会话文件仍会正常触发新任务通知。

## 0.3.5 - 2026-08-24

### Fixed / 修复

- Codex completion monitoring now watches both the local UI environment and the connected WSL, Remote SSH, or container environment by default, preventing local Codex Desktop tasks from being missed in remote VS Code windows.
- Codex 完成监听现在默认同时覆盖本地 UI 环境和当前连接的 WSL、Remote SSH 或容器环境，避免远程 VS Code 窗口漏掉本地 Codex Desktop 任务。
- Windows drive paths and equivalent WSL `/mnt/<drive>` paths now match the same workspace.
- Windows 盘符路径与对应的 WSL `/mnt/<盘符>` 路径现在会识别为同一工作区。
- Diagnostics now list every monitored Codex sessions root and the outcome of the latest completion event.
- 诊断信息现在会列出全部 Codex sessions 监听目录及最近一次完成事件的处理结果。

## 0.3.4 - 2026-08-24

### Changed / 变更

- Updated current README references and plugin recommendations to use the new `Agent Center` display name while retaining the existing Marketplace extension ID.
- README 当前说明及插件推荐现统一使用新的 `Agent Center` 展示名称，同时保留原有 Marketplace 扩展 ID。

## 0.3.3 - 2026-08-24

### Fixed / 修复

- Subagent identity is now preserved when inherited parent-session metadata appears later in the same Codex JSONL file, preventing notifications before the main task completes.
- 当 Codex 子代理 JSONL 后续出现继承的主会话元数据时，现在会保留子代理身份，避免主任务完成前提前发送通知。
- Session identity is reset when a tracked Codex JSONL file is truncated and rebuilt.
- Codex JSONL 文件截断重建时会同步重置会话身份。

## 0.3.2 - 2026-08-20

### Fixed / 修复

- Desktop notification clicks now recognize additional Windows/SnoreToast activation values and reliably restore the originating VS Code window through native activation retries.
- 桌面通知点击现在兼容更多 Windows/SnoreToast 激活值，并通过原生窗口激活与重试可靠恢复通知来源 VS Code 窗口。
- Notifyer diagnostics now include the latest notification callback and window-focus result.
- Notifyer 诊断信息现在会显示最近一次通知回调和窗口聚焦结果。

## 0.3.1 - 2026-08-19

### Changed / 变更

- Added the complete plugin recommendation list to both READMEs and updated the Agent Status Marketplace link.
- 在中英文 README 中新增完整的插件推荐列表，并更新 Agent Status 插件市场链接。

## 0.3.0 - 2026-08-19

### Changed / 变更

- Notifyer now focuses exclusively on local desktop and VS Code notifications for Codex, Claude, and terminal tasks.
- Notifyer 现在专注于 Codex、Claude 与 Terminal 任务的本地桌面和 VS Code 通知。
- Codex and Claude quota status items moved to the independent `Agent Status` workspace extension, which runs directly in each local or remote workspace environment.
- Codex 与 Claude 额度状态栏迁移到独立的 `Agent Status` Workspace 扩展，由它直接运行在每个本地或远程工作区环境中。
- Removed the intermediate hidden Workspace Companion design and all cross-extension quota protocol code.
- 移除中间的隐藏 Workspace Companion 方案以及全部跨扩展额度协议代码。

## 0.2.21 - 2026-08-19

### Changed / 变更

- Codex and Claude quota items now show an animated refresh indicator while startup, scheduled, or manual usage requests are in progress.
- Codex 与 Claude 额度部件现在会在启动、定时或手动额度请求进行期间显示旋转的“刷新中”动画。

## 0.2.20 - 2026-08-19

### Changed / 变更

- Codex and Claude quotas now refresh immediately at startup, then automatically every 30 seconds for 3 minutes (six scheduled retries) before returning to the configured regular interval, which defaults to 10 minutes.
- Codex 与 Claude 额度现在会在启动时立即刷新，随后在前 3 分钟内每 30 秒自动刷新一次（共 6 次定时重试），之后恢复配置的常规间隔，默认 10 分钟。

## 0.2.19 - 2026-08-19

### Changed / 变更

- Codex and Claude quota tooltips now explain the compact status-bar percentage and local reset timestamp, including which quota window is represented.
- Codex 与 Claude 额度悬浮面板现在会解释状态栏百分比、本地重置时间以及当前代表的额度窗口。
- Claude quota details are now consistently displayed in Chinese while preserving the account plan, all available quota windows, update time, and action links.
- Claude 额度详情现统一使用中文，同时保留套餐、全部可用额度窗口、更新时间及操作链接。

## 0.2.18 - 2026-08-19

### Changed / 变更

- Codex and Claude quota reset times now use the local `month-day hour:minute` format, such as `5% left | 8-20 11:24`; the trailing `reset` label was removed.
- Codex 与 Claude 额度重置时间现使用本地时间的“月-日 时:分”格式，例如 `5% left | 8-20 11:24`，并移除末尾的 `reset`。

## 0.2.17 - 2026-08-19

### Changed / 变更

- Terminal desktop notifications now monitor only Python commands by default. Supported commands include `python`, `python3`, versioned executables such as `python3.12`, Windows `py` and `pythonw`, and full paths such as `/opt/conda/envs/.../bin/python`.
- 终端桌面通知默认仅监听 Python 命令，支持 `python`、`python3`、`python3.12`、Windows 的 `py`/`pythonw`，以及 `/opt/conda/envs/.../bin/python` 这类完整路径。
- Turn off `codexTaskCompanion.terminal.pythonOnly` to restore notifications for every command outside the ignored-command list.
- 关闭 `codexTaskCompanion.terminal.pythonOnly` 后，可以恢复监听忽略列表之外的全部命令。
- Codex and Claude status bar items now use a compact format such as `5% left | 8-20 reset` or `5% used | 8-20 reset`, with the reset date shown as the local month and day.
- Codex 与 Claude 状态栏现采用 `5% left | 8-20 reset` 或 `5% used | 8-20 reset` 这样的紧凑格式，重置日期按本地月份和日期显示。
- Codex and Claude quota credentials are now isolated to the environment connected by the current VS Code window. Local Windows, WSL, Remote SSH, and container windows no longer fall back to another environment or scan other users' home directories.
- Codex 与 Claude 额度凭据现按当前 VS Code 窗口连接的环境严格隔离。本地 Windows、WSL、Remote SSH 与容器窗口不再回退到其他环境，也不会扫描其他用户的主目录。
- Added `codexTaskCompanion.codex.credentialsPath` for unusual credential layouts. Both Codex and Claude custom credential paths are resolved only inside the current VS Code environment.
- 新增 `codexTaskCompanion.codex.credentialsPath`，用于特殊的凭据目录布局；Codex 与 Claude 的自定义凭据路径都只会在当前 VS Code 环境中解析。

## 0.2.16 - 2026-08-18

### Fixed / 修复

- Clicking a Codex desktop notification now restores only the originating VS Code window and no longer opens a new Codex conversation tab.
- 点击 Codex 桌面通知时仅恢复来源 VS Code 窗口，不再自动打开新的 Codex 会话标签页。

## 0.2.15 - 2026-08-18

### Fixed / 修复

- Improved multi-window targeting by capturing the originating VS Code window and preferring VS Code's native window-focus command.
- 通过记录通知来源窗口并优先使用 VS Code 原生窗口聚焦命令，提高多窗口定位准确性。

## 0.2.14 - 2026-08-18

### Fixed / 修复

- Clicking a desktop notification now targets the VS Code window that generated it.
- 点击桌面通知时会定位到产生通知的 VS Code 窗口。
- Terminal notifications additionally restore the originating terminal.
- 终端通知会进一步恢复产生通知的原终端。

## 0.2.13 - 2026-08-18

### Changed / 变更

- Expanded terminal notifications from Python-only commands to all commands except common navigation and information commands in the ignored list.
- 将终端通知从仅 Python 命令扩展到忽略列表之外的所有命令，默认排除常见导航和查询命令。

## 0.2.12 - 2026-08-17

### Added / 新增

- Added desktop notifications for Codex and Claude Code main-task completion.
- 新增 Codex 和 Claude Code 主任务完成桌面通知。
- Added Python terminal-task notifications and Codex/Claude remaining-usage indicators in the VS Code status bar.
- 新增 Python 终端任务通知，并在 VS Code 状态栏显示 Codex 与 Claude 剩余额度。
