# Notifyer

语言：<a href="./README.md">English（默认）</a> | <a href="./README.zh-CN.md">简体中文</a>

Notifyer 是一个 VS Code 插件，将 Codex 与 Claude Code 任务通知、两者的剩余额度显示和 Python terminal 通知整合在一起。

使用 Codex、Claude Code 等 AI 编程工具时，你是否也遇到过这样的场景：

> 代码交给 AI 生成，测试交给终端执行，构建和部署一等就是几十分钟。期间你不敢离开电脑，生怕错过任务完成、测试失败，或者 AI 正在等待你确认。

真正消耗时间的，往往不是编码本身，而是反复切回终端查看进度。这个项目，正是为了解决这个问题而来。它提供了一组 VS Code 插件，让开发者可以把长时间运行的任务交给终端和 AI Agent，自己去处理其他工作；任务完成后，系统会通过桌面通知或 VS Code 通知及时提醒你。

## 它能做什么？

### 1、监听 AI 编程任务（桌面通知）

<img alt="1786957667033" src="image/1/1786957667033.png" width="364" height="136">

支持监听 Codex、Claude Code 等 AI Agent 的主任务状态。当任务完成时，插件会自动发送桌面通知；子 Agent 和后台过程不会频繁打扰你，让通知真正有价值。

### 2、Terminal命令监听（桌面通知）

<img alt="1786957707385" src="image/1/1786957707385.png" width="370" height="153">

支持监听Termin中运行的任务状态。当任务失败或者成功时，插件会自动发送桌面通知

### 3、随时查看 Codex 和 Claude 使用额度（vscode中显示）

<img alt="1786984705972" src="image/README.zh-CN/1786984705972.png" width="393" height="140">

还可以直接在 VS Code 状态栏中显示 Codex、Claude Code 的额度使用情况，包括剩余比例、使用比例以及重置时间。不用频繁打开网页或终端，就能随时掌握当前账号状态。
