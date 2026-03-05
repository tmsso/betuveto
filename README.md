# Betűvető - Hungarian Word Game

A fun word puzzle game where you form Hungarian words from scrambled letters!

## 🎮 How to Play

1. **Start a new game** - Click the "New Game" button in the sidebar
2. **Look at the scrambled letters** - These are the letters you can use
3. **Form Hungarian words** - Type words using only the available letters
4. **Score points** - Longer words give more points (word length squared)
5. **Use hints** - Press "Hint" to reveal the full word
6. **Try to win** - Find as many words as possible before using the hint!

## 🏆 Scoring System

- 2-letter word = 4 points
- 3-letter word = 9 points
- 4-letter word = 16 points
- 5-letter word = 25 points
- 6-letter word = 36 points
- 7-letter word = 49 points

## 🚀 Quick Start

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run the app:
   ```bash
   streamlit run streamlit_app.py
   ```

3. Open your browser to `http://localhost:8501`

## 📁 Project Structure

```
betuveto/
├── streamlit_app.py      # Main Streamlit application
├── game_logic.py         # Game engine (separated from UI)
├── data/
│   └── magyar-szavak.txt # Hungarian words database
├── requirements.txt      # Python dependencies
└── README.md            # This file
```

## 🔧 Technical Details

- **Framework**: Streamlit
- **Language**: Python 3.8+
- **Data Source**: 161,745+ Hungarian words
- **Game Logic**: Modular design separated from UI
- **Styling**: Custom CSS for beautiful game interface

## 🎯 Features

- ✨ Beautiful, responsive design
- 🎮 Intuitive game controls
- 📊 Real-time score tracking
- 💡 Hint system to reveal full word
- 🏆 High score tracking (coming soon)
- 📱 Mobile-friendly interface

## 🤝 Contributing

Found a bug or have a feature request? Open an issue on GitHub!

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

**Created with ❤️ using Streamlit**