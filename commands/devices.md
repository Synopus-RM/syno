---
description: Syno Devices — keep the desktop (Windows, macOS, Linux) and mobile (Android, iOS) apps matched to the web app. Subcommands: status, report, setup, update, release
argument-hint: "status | report | setup | update | release"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. The building is done by the Syno Devices skills: **devices** (set up and keep in sync), **devices-desktop**, **devices-mobile** and **devices-release**. The first word of $ARGUMENTS picks what to do; with none, do **status**.

## status

Run `syno devices status` and show a short table: platform, status (In sync, Behind, Not released yet, Not set up), and the app and web versions. Say in one line what the owner needs to do, if anything.

## report

Run `syno devices report` (dry run), then ask with AskUserQuestion: "Save the device apps report?" Options: "Save it (Recommended)" and "Just show it". Run `syno devices report --confirm` only on yes, and say where the HTML page is.

## setup, update, release

Follow the **devices** skill: setup is its Workflow A, update is Workflow B, and a status check is Workflow C. For releases, follow **devices-release**.

Every build runs through Syno Governor (`gov run`). Any push, tag push, store upload or workflow run needs its own yes: ask with AskUserQuestion before each one, and only on a yes run it.
