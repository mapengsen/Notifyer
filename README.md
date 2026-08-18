# Notifyer

Language: <a href="https://github.com/mapengsen/Notifyer">English (default)</a> | <a href="https://github.com/mapengsen/Notifyer/blob/main/README.zh-CN.md">简体中文</a>

Notifyer is a VS Code extension that combines Codex and Claude Code task notifications, remaining usage for both providers, and terminal command notifications in one place.

When using AI coding tools such as Codex and Claude Code, have you ever run into this situation?

> You hand code generation to AI, run tests in the terminal, and wait tens of minutes for builds and deployments. You hesitate to step away because you might miss a completed task, a failed test, or an AI waiting for confirmation.

What really consumes time is often not coding itself, but repeatedly switching back to the terminal to check progress. This project is designed to solve that problem. It provides a VS Code extension that lets developers hand long-running tasks to the terminal and AI agents while working on something else; when a task finishes, desktop or VS Code notifications let you know promptly.

## What can it do?

### 1. Monitor AI coding tasks (desktop notifications)

<img alt="AI coding task desktop notification" src="image/1/1786957667033.png" width="364" height="136">

Notifyer monitors the main-task status of AI agents such as Codex and Claude Code. When a task finishes, the extension sends a desktop notification. Child agents and background processes do not constantly interrupt you, keeping notifications useful.

### 2. Monitor terminal commands (desktop notifications)

<img alt="Terminal command desktop notification" src="image/1/1786957707385.png" width="370" height="153">

Notifyer monitors commands running in the terminal and sends a desktop notification when a command succeeds or fails. Common navigation and information commands such as `ls`, `ll`, and `pwd` are ignored by default; you can customize the ignored-command list in VS Code settings.

When you click a desktop notification, Notifyer targets the exact VS Code window that produced it. Codex notifications preserve the current editor and layout; terminal notifications additionally reveal the originating terminal.

### 3. View Codex and Claude usage in VS Code

<img alt="Codex and Claude usage in VS Code" src="image/README.zh-CN/1786984705972.png" width="393" height="140">

Notifyer can display Codex and Claude Code usage directly in the VS Code status bar, including remaining percentages, used percentages, and reset times. You can keep track of the current account status without repeatedly opening a webpage or terminal.

# Changelog

## August 18, 2026 (0.2.16)

1. Clicking a Codex desktop notification now only restores the originating VS Code window and no longer opens a Codex conversation tab automatically.

## August 18, 2026

1. Fixed an issue where clicking a notification with multiple VS Code windows open would only activate the last-used window.

2. Terminal notifications now restore the originating terminal in the correct VS Code window.

## August 18, 2026, 10:10:55

1. Added desktop notifications for all terminal commands except common Linux commands such as `ls`, `ll`, and `pwd`.

2. Clicking a desktop notification now prioritizes the VS Code window that generated it; terminal notifications additionally reveal the corresponding terminal.
