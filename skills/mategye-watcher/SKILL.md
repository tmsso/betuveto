---
name: mategye-watcher
description: Monitors the Zrínyi final page for document or detail updates using free tier models.
user-invocable: true
---

# Mategye Watcher (Native)

Dedicated monitor for `http://mategye.hu/?pid=zrinyi_verseny/donto`.

## Logic
1. **Fetch:** Scrape the specific final-round page.
2. **Compare:** Use internal ` registry.json` to detect structural or text changes.
3. **Analyze:** If changed, use `openrouter/openrouter/free` to describe exactly what changed (new PDFs, updated dates).
4. **Notify:** Deliver a detailed Telegram message only when relevance is detected.
