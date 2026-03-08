# Betűvető - Hungarian Word Game

A modern, full-stack Hungarian word puzzle game! Form words from 7 scrambled letters to score points.

## 🏗️ Architecture

This project was recently refactored from Streamlit into a modern full-stack application:

*   **Frontend**: React (Vite) with Tailwind CSS for a responsive, interactive UI.
*   **Backend**: FastAPI (Python) for robust game logic and API endpoints.

## 🎮 How to Play

1. **Start a new game**: The game starts automatically. Click "Új Játék" (New Game) anytime.
2. **Form words**: Use the 7 scrambled letters provided. You can click the letter tiles or type on your keyboard.
3. **Submit**: Click the ✅ button or press Enter to submit your guess.
4. **Score points**: You earn points based on the word length squared (e.g., a 4-letter word is 16 points).
5. **Rescramble**: The letters automatically rescramble every 5 guesses to help you see new patterns, or you can use the scramble button.
6. **Celebrate**: Find all 7 letters or a 7-letter word for a special celebration!

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js (v18+)
- Python (3.10+)

### 1. Setup Backend (FastAPI)

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
*The backend runs on `http://localhost:8000` and provides Swagger API docs at `http://localhost:8000/docs`.*

### 2. Setup Frontend (React + Vite)

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```
*The frontend runs on `http://localhost:5173`.*

## 📁 Project Structure

```
betuveto/
├── backend/              # FastAPI Python backend
│   ├── main.py           # API endpoints and game state handling
│   ├── requirements.txt  # Python dependencies
│   └── Dockerfile        # Docker configuration for backend deployment
├── frontend/             # React (Vite) frontend
│   ├── src/              # React components (App.jsx), styling, API client
│   ├── package.json      # Node.js dependencies
│   └── vite.config.js    # Vite configuration (includes API proxy)
├── data/                 # Game data
│   └── magyar-szavak.txt # Hungarian words dictionary (~161k words)
├── vercel.json           # Configuration for Vercel frontend deployment
└── README.md             # This file
```

## 🔧 Deployment Details

- **Frontend**: Designed to be deployed on Vercel. Ensure `VITE_API_BASE_URL` in your Vercel environment variables points to your deployed backend URL.
- **Backend**: Can be containerized using the provided `backend/Dockerfile` and deployed to any Docker-compatible platform (e.g., Hugging Face Spaces, Railway, Render).

## 🎯 Features

- ✨ Modern, responsive React UI with Tailwind CSS.
- 🎮 Intuitive controls (click to type, keyboard support).
- 🎉 Visual celebrations (react-canvas-confetti) for achievements.
- ⚡ Fast and robust FastAPI backend validating against a 161k+ word dictionary.
- 🔄 Auto-rescramble logic and visual feedback (shake on invalid guess).

## 🤝 Contributing

Found a bug or have a feature request? Open an issue on GitHub!

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
