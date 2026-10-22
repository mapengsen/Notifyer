# Notifyer

语言：<a href="./README.md">English（默认）</a> | <a href="./README.zh-CN.md">简体中文</a>

Notifyer 提供 Codex、Claude Code 主任务与 Terminal 命令完成通知，并在 Windows 桌面用悬浮小窗汇总多个 VS Code 窗口的对话状态。

使用 Codex、Claude Code 等 AI 编程工具时，你是否也遇到过这样的场景：

> 代码交给 AI 生成，测试交给终端执行，构建和部署一等就是几十分钟。期间你不敢离开电脑，生怕错过任务完成、测试失败，或者 AI 正在等待你确认。

真正消耗时间的，往往不是编码本身，而是反复切回终端查看进度。这个项目，正是为了解决这个问题而来。它提供了一组 VS Code 插件，让开发者可以把长时间运行的任务交给终端和 AI Agent，自己去处理其他工作；任务完成后，系统会通过桌面通知或 VS Code 通知及时提醒你。

**GitHub**: [github.com/mapengsen/Notifyer](https://github.com/mapengsen/Notifyer)

**Plugin**: [marketplace.visualstudio.com/items?itemName=pengsen.codex-task-companion](https://marketplace.visualstudio.com/items?itemName=pengsen.codex-task-companion)

## 功能一览

| 功能 | 说明 |
| --- | --- |
| Codex / Claude Code | 主任务完成提醒，过滤子 Agent。 |
| 终端命令 | 成功、失败提醒；默认仅 Python，可配置监听其他命令及忽略列表。 |
| 通知方式 | 桌面通知、VS Code 通知或两者；支持仅窗口失焦时提醒，桌面发送失败时回退到 VS Code。 |
| Windows 桌面悬浮窗 | 同一 VS Code 用户配置下，跨窗口汇总运行中与待查看会话；点击 VS Code 底部右侧的 Notifyer 图标显示／隐藏。 |
| 查看流程 | 点击会话卡片切回匹配窗口，手动标记已查看后立即移除；查看状态重启后保留。 |
| 外观与操作 | 太阳／月亮图标切换昼夜配色，默认白天，白天文字为纯黑；桌面通知默认关闭，可手动开启；支持置顶、拖动、折叠和隐藏，偏好会保存。 |
| 本地与远程项目 | 本机 UI 监听可访问的本地、WSL、Remote SSH 和容器会话；悬浮窗显示在本机 Windows 桌面。 |
| 稳定性与诊断 | 历史扫描静默、多窗口完成通知去重、悬浮窗进程恢复、通知测试与诊断命令。 |

## 开始使用

1. 从 [VS Code 插件市场](https://marketplace.visualstudio.com/items?itemName=pengsen.codex-task-companion) 安装或更新 **Notifyer**。使用远程项目时，在本地 VS Code UI 侧启用；需要监控的各窗口都应在同一用户配置下启用此版本。
2. 更新后，在各个已打开的 VS Code 窗口执行 **Developer: Reload Window**，然后启动 Codex / Claude Code 对话，或在集成终端运行 Python 命令。
3. Windows 桌面会自动显示悬浮窗，点击 **VS Code 底部右侧状态栏的 Notifyer 图标**即可显示／隐藏，无需打开命令面板。点击太阳／月亮图标切换配色；桌面通知默认关闭，需要时点击“桌面通知 关”开启，或运行 **Notifyer: Toggle Desktop Notifications**（所有平台可用）。点击会话卡片返回匹配窗口，查看结果后标记已查看。

| 命令面板操作 | 用途 |
| --- | --- |
| `Notifyer: Toggle Floating Window` | 显示／隐藏 Windows 悬浮窗，与状态栏 Notifyer 图标执行相同操作。 |
| `Notifyer: Show Floating Window` | 打开或恢复 Windows 共享悬浮窗。 |
| `Notifyer: Hide Floating Window` | 隐藏悬浮窗。 |
| `Notifyer: Toggle Desktop Notifications` | 开启或关闭桌面通知，所有平台可用；默认关闭，手动选择会保存。 |
| `Notifyer: Test Desktop Notification` | 测试当前通知链路，桌面通知开关也对该测试生效。 |
| `Notifyer: Show Diagnostics` | 查看会话监听、通知发送和悬浮窗进程状态。 |
| `Notifyer: Open Settings` | 配置通知方式、会话目录和终端过滤规则。 |

**我的所有插件推荐：**

1. **Notifyer Plugin**: [marketplace.visualstudio.com/items?itemName=pengsen.codex-task-companion](https://marketplace.visualstudio.com/items?itemName=pengsen.codex-task-companion)
2. **Agent Center**：[marketplace.visualstudio.com/items?itemName=pengsen.codex-claude-agent-status](https://marketplace.visualstudio.com/items?itemName=pengsen.codex-claude-agent-status)

## 它能做什么？

### 1、监听 AI 编程任务（桌面通知）

<img alt="1786957667033" src="image/1/1786957667033.png" width="364" height="136">

支持监听 Codex、Claude Code 等 AI Agent 的主任务状态。当任务完成时，插件会自动发送桌面通知；子 Agent 和后台过程不会频繁打扰你，让通知真正有价值。

在 WSL、Remote SSH 和容器窗口中，Codex 监听默认会同时覆盖当前连接环境与本地 UI 环境。因此，同一个 VS Code 窗口既能识别远程 Codex，也能识别本地 Codex Desktop 写入的任务。只有希望仅监听一个指定目录时，才需要设置 `codexTaskCompanion.codex.sessionsRoot`。

### 2、Terminal命令监听（桌面通知）

<img alt="1786957707385" src="image/1/1786957707385.png" width="370" height="153">

支持监听 Terminal 中运行的命令状态。当命令失败或者成功时，插件会自动发送桌面通知。默认仅通知 Python 命令，包括 `python`、`python3`、`python3.12`、Windows 的 `py`/`pythonw`，以及 `/opt/conda/envs/.../bin/python` 这类完整路径。关闭 `codexTaskCompanion.terminal.pythonOnly` 后，可以恢复监听忽略列表之外的全部命令。

点击桌面通知时，Notifyer 会恢复产生通知的准确 VS Code 窗口。Codex 通知会保留当前编辑器和布局，不再自动打开会话；终端通知会进一步显示原终端。

### 3、Windows 桌面会话悬浮窗

![Windows 悬浮窗，示例数据](image/floating-panel-preview.png)

夜晚配色（示例数据）：

![Windows 悬浮窗夜晚配色](image/floating-panel-night-preview.png)

Windows 上默认自动显示一份共享悬浮窗，无需另外安装桌面运行时。每个 VS Code 窗口都需要安装并启用此版本的 Notifyer，使用相同的 VS Code 用户配置；Remote SSH、WSL 或容器窗口仍由本机 UI 扩展采集当前可访问的会话。界面每约 2 秒更新，显示每个对话最新一轮的状态：

- **运行中**：已观察到任务开始或对话活动，显示运行时长。
- **已完成 / 发生错误 · 待查看**：首次扫描完成之后观察到的新结果，保留到手动点击“标记已查看”。只返回窗口不会清除待查看；已查看标记在各窗口之间共享，重启后保留。

界面仅保留运行中与待查看的会话。“标记已查看”会立即移除该项；首次扫描的历史完成记录不显示。窗口关闭、扩展断连、任务中止，或运行中超过默认 30 分钟没有新日志的会话会转为待确认，并从运行列表隐藏；长时间工具执行和等待审批也可能暂时没有日志，不代表失败。

拖动顶部移动小窗，太阳／月亮图标切换配色（默认白天，文字为纯黑），“桌面通知 开 / 关”切换所有窗口的桌面提醒（默认关闭），“置顶”切换始终置顶，“− / +”折叠或展开，“×”隐藏。主题、桌面通知开关、位置、置顶及折叠状态会保存；以前手动开启的桌面通知选择会保留。关闭桌面通知仍会继续采集状态并保留待查看结果；若原来配置了 VS Code 内通知，该通道继续生效。隐藏后点击 **VS Code 底部右侧状态栏的 Notifyer 图标**即可重新显示，再点一次隐藏；图标和提示会随真实显隐状态更新，多个窗口之间共享状态。命令面板中的 **Notifyer: Show Floating Window** 与 **Notifyer: Hide Floating Window** 仍可使用。

单击整张会话卡片即可切回匹配的 VS Code 窗口，也可以用 Tab 聚焦后按 Enter 或空格；具体对话需在窗口内选择。同一个项目被多个窗口打开时，会弹出匹配窗口的选择列表；会话日志通常只能关联到项目，不能证明对话属于其中哪个窗口。来源工作目录未知的会话不纳入总览，子 Agent 不显示。点击“标记已查看”不会触发窗口跳转。

设置 `codexTaskCompanion.floatingWindow.enabled` 为 `false` 可以关闭采集和悬浮窗；`codexTaskCompanion.floatingWindow.quietAfterMinutes` 可调整无新日志的判断时间。关闭浮窗不影响原有通知。状态及对话标题片段只保存在本机扩展存储内，不额外发送到外部服务。浮窗当前仅汇总 Codex / Claude 对话，终端仍使用原有完成通知。

开发验证：`npm run test:unit`；Windows 原生界面与按钮验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-floating-panel.ps1`，生成使用示例数据的界面截图，不会打开桌面窗口。

如果安装后只有通知而没有小窗，点击连接服务器的 VS Code 窗口底部右侧 **Notifyer 图标**，或运行 **Notifyer: Show Floating Window**；小窗显示在本机 Windows 桌面上。升级后若没有状态栏入口，请先执行一次 **Developer: Reload Window**。0.4.1 起会检测小窗进程心跳并自动恢复意外退出的进程。仍未出现时，运行 **Notifyer: Show Diagnostics** 查看 `floatingWindow.helperHealthy`、`lastError`、`panelError` 与 `lastExit`，以及“输出 → Notifyer Floating Window”中的启动日志。

# 如果出现问题：

确保你的Windows的通知是打开的，请勿打扰是关闭的

![1787557948450](image/README.zh-CN/1787557948450.png)

## Codex 与 Claude 额度显示

从 0.3.0 开始，额度显示已经迁移到独立插件 **Agent Center**：

- Agent Center 只负责 Codex/Claude 额度状态栏，不包含桌面通知。
- 普通本地窗口中运行在本机；Remote SSH、WSL 或容器窗口中直接运行在对应工作区环境。
- 远程凭据读取和额度请求完全在远程服务器内完成，不需要隐藏 Companion，也不会在扩展之间传递令牌。

Agent Center：[marketplace.visualstudio.com/items?itemName=pengsen.codex-claude-agent-status](https://marketplace.visualstudio.com/items?itemName=pengsen.codex-claude-agent-status)

# 更新日志：

## 2026年10月22日（0.4.4）：

1. 新增 VS Code 底部右侧 Notifyer 状态栏入口，单击显示／隐藏桌面悬浮窗。
2. 眼睛图标及提示随实际显隐状态更新，小窗右上角隐藏、多窗口操作和连续点击保持同步。
3. 新增 **Notifyer: Toggle Floating Window** 命令；悬浮窗进程未运行时，点击入口会尝试恢复。

## 2026年10月22日（0.4.3）：

1. 主题按钮改为太阳／月亮图标，白天文字统一为纯黑。
2. 桌面通知默认关闭，缺失或无效的偏好也默认关闭；保留已手动保存的开关选择。
3. 新增跨平台命令 **Notifyer: Toggle Desktop Notifications**，无需悬浮窗也可切换桌面通知。

## 2026年10月22日（0.4.2）：

本次发布包含 0.4.0 新增的跨窗口桌面监控与 0.4.1 的进程恢复修复，并提供以下外观和查看流程改进。

1. 新增默认白天的昼夜主题按钮，以及跨窗口共享并持久化的桌面通知开关。
2. 删除“会话总览”副标题，列表仅显示运行中和待查看；已查看后立即移除。
3. 整张会话卡片可点击切回窗口，移除“返回窗口”按钮；保留同项目多窗口选择。

## 2026年10月22日（0.4.1）：

1. 新增悬浮窗启动日志、进程心跳与退出后的退避自动恢复；手动隐藏不会触发重新显示。
2. 修复 Windows 原生状态读取阻止文件替换的问题，避免暂时的状态写入错误跳过启动。

## 2026年10月22日（0.4.0）：

1. 新增 Windows 桌面会话悬浮窗，汇总多个 VS Code 窗口中的 Codex / Claude 最新轮次状态。
2. 支持置顶、拖动、折叠、隐藏与恢复、返回匹配窗口和共享的“标记已查看”。
3. 新增断连及日志静默检测；首次历史扫描不产生新的待查看结果。

## 2026年9月15日（0.3.6）：

1. Codex 与 Claude 首次会话扫描现在默认严格静默建立基线，不再因本机与远程服务器时间不一致而补发历史完成通知。
2. 完成事件现在会在插件全局存储中进行原子认领；同时打开多个 VS Code 窗口时，同一个任务只会弹出一次通知。
3. 首次基线建立后才发现的新会话文件仍会正常触发新任务通知。

## 2026年8月24日（0.3.5）：

1. Codex 监听现在默认同时覆盖本地与当前连接的 WSL、Remote SSH 或容器会话目录，避免远程 VS Code 窗口漏掉本地 Codex Desktop 完成事件。
2. Windows 盘符路径与对应的 WSL `/mnt/<盘符>` 路径现在会识别为同一工作区。
3. Notifyer 诊断信息现在会显示全部 Codex sessions 监听目录及最近一次完成事件的处理结果。

## 2026年8月24日（0.3.4）：

1. README 当前说明及插件推荐统一使用新的 Agent Center 展示名称，同时保留原有 Marketplace 扩展 ID。

## 2026年8月24日（0.3.3）：

1. 修复 Codex 多代理任务中，继承的主会话元数据覆盖子代理身份并导致主任务完成前提前弹窗的问题。
2. Codex 会话 JSONL 文件截断重建时，现在会正确重置会话身份。

## 2026年8月20日（0.3.2）：

1. 修复点击 Windows 桌面通知后无法返回通知来源 VS Code 窗口的问题；兼容更多点击回调值，并增加原生窗口激活回退和重试。
2. Notifyer 诊断信息新增最近一次通知点击回调与窗口聚焦结果。

## 2026年8月19日（0.3.1）：

1. 在中英文 README 中新增“我的所有插件推荐”，并更新 Agent Status 插件市场链接。

## 2026年8月19日（0.3.0）：

1. Notifyer 现在专注于 Codex、Claude 和 Terminal 的本地通知。
2. Codex 与 Claude 额度显示迁移到独立插件 Agent Status；不再使用隐藏的 Workspace Companion。

## 2026年8月19日（0.2.21）：

1. Codex 与 Claude 额度部件现在会在启动、定时或手动刷新请求进行期间显示旋转的“刷新中”动画。

## 2026年8月19日（0.2.20）：

1. Codex 与 Claude 额度在启动时立即刷新，随后在前 3 分钟内每 30 秒自动重试一次，之后恢复默认 10 分钟的常规刷新间隔。

## 2026年8月19日（0.2.19）：

1. 鼠标悬停在 Codex 或 Claude 额度部件上时，现在会解释百分比和重置时间的含义、标明当前代表的额度窗口，并在下方保留各窗口的完整详情。

## 2026年8月19日（0.2.18）：

1. Codex 与 Claude 额度状态栏现在显示完整的本地重置日期和时间，例如 `5% left | 8-20 11:24` 或 `5% used | 8-20 11:24`。

## 2026年8月19日（0.2.17）：

1. Terminal 桌面通知默认仅监听 Python 命令，同时支持 Conda 环境中的完整 Python 可执行文件路径；可在设置中关闭仅 Python 模式以恢复原行为。
2. Codex 与 Claude 额度状态栏改为紧凑单行格式，例如 `5% left | 8-20 reset` 或 `5% used | 8-20 reset`，重置日期以本地月份和日期显示。
3. Codex 与 Claude 额度凭据改为按当前 VS Code 环境严格隔离。本地 Windows、WSL、Remote SSH 与容器只读取各自的登录文件，不再跨环境回退或扫描其他用户目录。

## 2026年8月18日（0.2.16）：

1. 点击 Codex 桌面通知时仅恢复来源 VS Code 窗口，不再自动打开 Codex 会话标签页。

## 2026年8月18日：

1. 修复多 VS Code 窗口时，点击通知只进入最后活跃窗口的问题。
2. 终端通知会在准确窗口中恢复原终端。

## 2026年8月18日10:10:55：

1. 增加所有的terminal命令都可以桌面通知，除了常见的Linux命令，例如ls,ll,pwd...
2. 点击桌面通知时，优先定位到产生通知的 VS Code 窗口；终端通知会进一步显示对应的终端。
