#!/bin/bash

# This "trap" ensures that if you stop the script, it kills both sub-processes
trap "kill 0" EXIT

echo "🚀 Starting Betűvető Full-Stack..."

# 1. Start the Backend (FastAPI)
(
  cd backend && 
  source venv/bin/activate && 
  uvicorn main:app --host 0.0.0.0 --port 8000
) &

# 2. Start the Frontend (Vite)
(
  cd frontend && 
  npm run dev -- --host
) &

# Keep the script running so the trap stays active
wait
