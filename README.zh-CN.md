# Notifyer

语言：<a href="./README.md">English（默认）</a> | <a href="./README.zh-CN.md">简体中文</a>

Notifyer 是一个专注于本地提醒的 VS Code 插件，负责 Codex、Claude Code 主任务和 Terminal 命令完成通知。

使用 Codex、Claude Code 等 AI 编程工具时，你是否也遇到过这样的场景：

> 代码交给 AI 生成，测试交给终端执行，构建和部署一等就是几十分钟。期间你不敢离开电脑，生怕错过任务完成、测试失败，或者 AI 正在等待你确认。

真正消耗时间的，往往不是编码本身，而是反复切回终端查看进度。这个项目，正是为了解决这个问题而来。它提供了一组 VS Code 插件，让开发者可以把长时间运行的任务交给终端和 AI Agent，自己去处理其他工作；任务完成后，系统会通过桌面通知或 VS Code 通知及时提醒你。

**GitHub**: [github.com/mapengsen/Notifyer](https://github.com/mapengsen/Notifyer)

**Plugin**: [marketplace.visualstudio.com/items?itemName=pengsen.codex-task-companion](https://marketplace.visualstudio.com/items?itemName=pengsen.codex-task-companion)

## 它能做什么？

### 1、监听 AI 编程任务（桌面通知）

<img alt="1786957667033" src="image/1/1786957667033.png" width="364" height="136">

支持监听 Codex、Claude Code 等 AI Agent 的主任务状态。当任务完成时，插件会自动发送桌面通知；子 Agent 和后台过程不会频繁打扰你，让通知真正有价值。

### 2、Terminal命令监听（桌面通知）

<img alt="1786957707385" src="image/1/1786957707385.png" width="370" height="153">

支持监听 Terminal 中运行的命令状态。当命令失败或者成功时，插件会自动发送桌面通知。默认仅通知 Python 命令，包括 `python`、`python3`、`python3.12`、Windows 的 `py`/`pythonw`，以及 `/opt/conda/envs/.../bin/python` 这类完整路径。关闭 `codexTaskCompanion.terminal.pythonOnly` 后，可以恢复监听忽略列表之外的全部命令。

点击桌面通知时，Notifyer 会恢复产生通知的准确 VS Code 窗口。Codex 通知会保留当前编辑器和布局，不再自动打开会话；终端通知会进一步显示原终端。

## Codex 与 Claude 额度显示

从 0.3.0 开始，额度显示已经迁移到独立插件 **Agent Status**：

- Agent Status 只负责 Codex/Claude 额度状态栏，不包含桌面通知。
- 普通本地窗口中运行在本机；Remote SSH、WSL 或容器窗口中直接运行在对应工作区环境。
- 远程凭据读取和额度请求完全在远程服务器内完成，不需要隐藏 Companion，也不会在扩展之间传递令牌。

Agent Status：[marketplace.visualstudio.com/items?itemName=pengsen.agent-status](https://marketplace.visualstudio.com/items?itemName=pengsen.agent-status)


# 更新日志：

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
