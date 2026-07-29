import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import hu from './locales/hu.json'
import en from './locales/en.json'

// No i18next-browser-languagedetector (ROADMAP 6.2): the initial language is resolved by
// App.jsx's existing mount effect, the same place it already resolves preferred_length —
// player preference (players.preferred_language) first, then navigator.language, then hu.
// Hand-rolling this one comparison keeps one fewer dependency for a single-condition check.
i18next.use(initReactI18next).init({
  resources: {
    hu: { translation: hu },
    en: { translation: en },
  },
  lng: 'hu',
  fallbackLng: 'hu',
  interpolation: { escapeValue: false }, // React already escapes; double-escaping breaks e.g. "Egy szó..."-style quotes
})

export default i18next
