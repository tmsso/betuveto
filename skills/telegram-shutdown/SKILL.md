---
name: telegram-shutdown
description: Shut down the X220 via Telegram command with a countdown and cancel option.
triggers:
  - pattern: '^/shutdown$'
    action:
      exec: /home/tomi/bin/shutdown_control.sh start
  - pattern: '^/cancel$'
    action:
      exec: /home/tomi/bin/shutdown_control.sh cancel
---
