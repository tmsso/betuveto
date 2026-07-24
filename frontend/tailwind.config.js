/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'game-primary': '#2c3e50',
        'game-secondary': '#3498db',
        'game-success': '#2ecc71',
        'game-warning': '#f39c12',
        'game-error': '#e74c3c',
        'game-paper': '#f8f9fa',
        'game-border': '#dee2e6',
      },
      fontFamily: {
        // Rounded, readable base face with full Hungarian (ő/ű) support.
        'sans': ['Nunito', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Curved display face for the title/headings (not handwritten/calligraphic).
        'display': ['"Baloo 2"', 'Nunito', 'system-ui', 'sans-serif'],
      },
      animation: {
        'shake': 'shake 0.5s',
        'bounce-in': 'bounceIn 0.6s',
        'letter-fly': 'letterFly 0.3s ease-out',
        'celebrate': 'celebrate 1s ease-in-out',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-5px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(5px)' },
        },
        bounceIn: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.05)' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        letterFly: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        celebrate: {
          '0%, 100%': { transform: 'scale(1) rotate(0deg)' },
          '25%': { transform: 'scale(1.1) rotate(-5deg)' },
          '75%': { transform: 'scale(1.1) rotate(5deg)' },
        },
      },
    },
  },
  plugins: [],
}