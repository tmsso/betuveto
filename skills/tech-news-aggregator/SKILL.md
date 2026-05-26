---
name: tech-news-aggregator
description: Aggregates tech news and drafts sarcastic LinkedIn posts using native OpenClaw free models.
user-invocable: true
---

# Tech News Aggregator (Native)

This skill utilizes the built-in `openrouter/openrouter/free` model to process news feeds.

## Logic
1. **Fetch:** Get latest headlines from `~/tech-news/sources.json`.
2. **Deduplicate:** Compare against `~/tech-news/data/registry.json`.
3. **Analyze:** Send new items to internal LLM for AI-relevance and LinkedIn potential.
4. **Draft:** Generate a sarcastic, professional LinkedIn post for top picks.
5. **Report:**
   - **Daily:** Send summary at 18:00.
   - **Weekly:** Ranked digest on Saturday 09:00.

## State
- All articles and drafts are stored in `~/tech-news/data/registry.json`.
- Tracking of development/developing stories is handled via the `last_updated` field in the registry.
