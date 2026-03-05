"""
Streamlit web application for Hungarian word puzzle game.
Uses the game_logic module to run the game.
"""
import streamlit as st
import streamlit_confetti as st_confetti
from pathlib import Path
import sys

# Add the current directory to path so we can import game_logic
sys.path.append(str(Path(__file__).parent))
from game_logic import WordGame

# Configure page
st.set_page_config(
    page_title="Betűvető - Hungarian Word Game",
    page_icon="🎯",
    layout="centered",
    initial_sidebar_state="expanded",
    menu_items={
        'Get Help': 'https://github.com/tmsso/betuveto/issues',
        'Report a bug': 'https://github.com/tmsso/betuveto/issues',
        'About': """# Betűvető - Hungarian Word Game

A fun word puzzle game where you form Hungarian words from scrambled letters!

**How to play:**
1. Look at the scrambled letters
2. Form Hungarian words using only those letters
3. Longer words give more points (word length squared)
4. Press "Hint" to reveal the full word
5. Try to get the highest score possible!

**Created with ❤️ using Streamlit**
        """
    }
)

# Custom CSS for styling
st.markdown("""
<style>
    .game-container {
        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        padding: 2rem;
        border-radius: 15px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
    }
    .title {
        color: #2c3e50;
        text-align: center;
        font-family: 'Georgia', serif;
        font-size: 3rem;
        margin-bottom: 1rem;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
    }
    .subtitle {
        color: #34495e;
        text-align: center;
        font-family: 'Georgia', serif;
        font-size: 1.2rem;
        margin-bottom: 2rem;
    }
    .letters-display {
        background: white;
        padding: 2rem;
        border-radius: 10px;
        text-align: center;
        font-size: 2rem;
        font-weight: bold;
        color: #2c3e50;
        border: 3px solid #3498db;
        margin: 2rem 0;
        letter-spacing: 0.5rem;
    }
    .score-display {
        background: #3498db;
        color: white;
        padding: 1rem;
        border-radius: 10px;
        text-align: center;
        font-size: 1.5rem;
        font-weight: bold;
        margin: 1rem 0;
    }
    .guess-input {
        font-size: 1.2rem;
        padding: 1rem;
        border-radius: 10px;
        border: 2px solid #3498db;
        margin: 1rem 0;
    }
    .stButton {
        background: #3498db;
        color: white;
        font-size: 1.1rem;
        padding: 1rem 2rem;
        border-radius: 10px;
        border: none;
        font-weight: bold;
    }
    .stButton:hover {
        background: #2980b9;
    }
    .feedback {
        padding: 1rem;
        border-radius: 10px;
        margin: 1rem 0;
        font-size: 1.1rem;
    }
    .feedback.success {
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
    }
    .feedback.warning {
        background: #fff3cd;
        color: #856404;
        border: 1px solid #ffeaa7;
    }
    .feedback.error {
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
    }
</style>
""", unsafe_allow_html=True)

def main():
    """Main Streamlit application."""
    # Title
    st.markdown('<div class="title">🎯 Betűvető</div>', unsafe_allow_html=True)
    
    # Initialize session state
    if 'game' not in st.session_state:
        st.session_state.game = None
        st.session_state.game_started = False
    
    # Initialize game
    wordlist_path = Path("data/magyar-szavak.txt")
    
    try:
        if st.session_state.game is None:
            st.session_state.game = WordGame(wordlist_path)
    except FileNotFoundError:
        st.error(f"Word list not found: {wordlist_path}")
        st.info("Please ensure the data/magyar-szavak.txt file exists.")
        return
    
    # Sidebar
    with st.sidebar:
        st.header("🎮 Játékvezérlés")
        
        if st.button("🎲 Új Játék", type="primary", use_container_width=True):
            try:
                scrambled = st.session_state.game.start_new_game()
                st.session_state.game_started = True
                st.session_state.guess_count = 0
                st.success("Új játék kezdődött! Sok sikert! 🍀")
                st.rerun()
            except Exception as e:
                st.error(f"Hiba az új játék indításakor: {e}")
        
        if st.session_state.game_started:
            game_state = st.session_state.game.get_game_state()
            st.subheader("📊 Statisztikák")
            st.metric("Pontszám", game_state['total_score'])
            st.metric("Talált Szavak", game_state['correct_guesses'])
            st.metric("Tipp Szám", st.session_state.get("guess_count", 0))
    
    # Main game area
    if not st.session_state.game_started:
        st.info("🎲 Kattints az **Új Játék** gombra a játék kezdéséhez!")
        return
    
    # Game is active
    game_state = st.session_state.game.get_game_state()
    
    # Display scrambled letters
    st.markdown(f'<div class="letters-display">{game_state["scrambled_letters"]}</div>', 
                unsafe_allow_html=True)
    
    # Score display
    st.markdown(f'<div class="score-display">🏆 Pontszám: {game_state["total_score"]} pont</div>', 
                unsafe_allow_html=True)
    
    # Guessed words section
    if st.session_state.game.correct_guesses:
        guessed_words = list(st.session_state.game.correct_guesses)
        word_display = " | ".join(guessed_words)
        st.markdown(f'<div style="background: #e8f5e8; padding: 1rem; border-radius: 10px; margin: 1rem 0;">{word_display}</div>', 
                    unsafe_allow_html=True)
    
    # Guess input
    guess = st.text_input(
        "✍️ Írd be a szót:",
        placeholder="Írj egy magyar szót...",
        key="guess_input",
        label_visibility="collapsed"
    ).upper()
    
    # Action buttons
    guess_button = st.button("🎯 Küldés", type="primary")
    hint_button = st.button("💡 Tipp")
    
    # Process actions
    if hint_button:
        # Show game instructions
        with st.expander("📖 Játékleírás", expanded=True):
            st.markdown("""
            **Cél**: Magyar szavak alkotása a megadott összekevert betűkből.
            
            **Pontozás**: Pontok = szó hossza négyzete (hosszabb szavak = több pont!)
            
            **Szabályok**:
            - Csak a megadott betűket használd
            - Minden szó csak egyszer pontozható
            - Írj be egy betűt a teljes szó megmutatásához
            - Próbálj meg minél több szót találni!
            
            **Példa**: Ha a betűk A B C D E F G, akkor alkothatsz:
            - "FA" (4 pont)
            - "BAD" (9 pont) 
            - "DEF" (9 pont)
            - "FACE" (16 pont)
            """)
        return
    
    # Process guess
    if guess:
        result = st.session_state.game.guess_word(guess)
        
        # Display feedback based on result
        if result['already_guessed']:
            st.markdown(f'<div class="feedback warning">{result["message"]}</div>', 
                       unsafe_allow_html=True)
        elif result['can_form'] and not result['already_guessed']:
            st.markdown(f'<div class="feedback success">{result["message"]}</div>', 
                       unsafe_allow_html=True)
            
            # Check if it's a 7-letter word for celebration
            if len(guess) == 7:
                st_confetti(confetti_size=3, spread=70, count=150, width=1000, height=1000)
        elif not result['can_form']:
            st.markdown(f'<div class="feedback error">{result["message"]}</div>', 
                       unsafe_allow_html=True)
        else:
            st.markdown(f'<div class="feedback error">{result["message"]}</div>', 
                       unsafe_allow_html=True)
        
        # Check if game ended (hint used)
        if len(guess) == 1 and result['valid']:
            st.session_state.game_started = False
            st.balloons()
            st.success("🎉 Köszönjük a játékot! Kattints az 'Új Játék' gombra a játék újraindításához.")
            st.rerun()
        
        # Update guess count and check for auto-rescramble
        st.session_state.guess_count = st.session_state.get("guess_count", 0) + 1
        
        # Auto-rescramble after every 5th guess
        if st.session_state.guess_count % 5 == 0:
            st.session_state.game.scrambled_letters = ' '.join(sorted(st.session_state.game.current_word))
            st.info(f"🔄 Betűk újrakeverve! ({st.session_state.guess_count}. tipp után)")
        
        # Clear input
        st.session_state["guess_input"] = ""
        st.rerun()

if __name__ == "__main__":
    main()