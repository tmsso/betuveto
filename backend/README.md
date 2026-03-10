---
title: Betuveto API
emoji: 🧩
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
---

# Betuveto API

This is the backend API for **Betuveto**, a Hungarian word game. It is built using FastAPI and served via Docker.

## Overview

This API serves the word lists and handles the core game logic. It interacts with the `data/` folder containing the Hungarian word dictionary (`magyar-szavak.txt`). 

## Tech Stack
- **Framework:** FastAPI
- **Language:** Python 3.10
- **Deployment:** Docker on Hugging Face Spaces

## API Documentation
Once running, you can access the automatic interactive API documentation (Swagger UI) by navigating to the `/docs` endpoint of the Space.
