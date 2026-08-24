# Changelog / 更新日志

All notable changes to Notifyer are documented in this file.

Notifyer 的重要变更都会记录在此文件中。

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
