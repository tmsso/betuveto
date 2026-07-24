#!/bin/bash
# Runs the frontend and the Vercel API functions on one origin (ROADMAP 1.3).
# `vercel dev` serves api/ itself and proxies everything else to the Vite dev
# server declared as `devCommand` in vercel.json — no separate backend, no proxy.
exec npx vercel dev
