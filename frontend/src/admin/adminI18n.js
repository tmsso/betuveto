import { createContext, useContext } from 'react'

/**
 * ROADMAP Batch 10 item 14 — a language switch scoped to the admin shell.
 *
 * Deliberately NOT react-i18next: the player app already initialises one shared i18next
 * instance (main.jsx), and `i18n.changeLanguage` on it is global — an admin toggling the
 * admin language would also flip the player-facing UI. The admin language must be
 * independent of a player's `preferred_language` (Batch 6.2), so this is a small
 * self-contained string map with `{{var}}` interpolation and a localStorage-persisted
 * choice, exactly the "lighter admin-only string map" the roadmap item offers as the
 * alternative.
 */

const STORAGE_KEY = 'bv_admin_lang'
const SUPPORTED = ['hu', 'en']

const STRINGS = {
  hu: {
    'app.title': 'Betűvető admin',
    'app.logout': 'Kijelentkezés',
    'app.langLabel': 'Nyelv',

    'login.emailLabel': 'E-mail cím',
    'login.emailPlaceholder': 'admin@example.com',
    'login.magicSend': 'Belépési link küldése',
    'login.magicSent': 'Belépési linket küldtünk a(z) {{email}} címre. Kattints rá az e-mailben, hogy bejelentkezz.',
    'login.magicError': 'Nem sikerült elküldeni a belépési linket.',
    'login.or': 'vagy',
    'login.tokenLabel': 'Admin token',
    'login.tokenSubmit': 'Belépés tokennel',

    'tabs.dashboard': 'Áttekintés',
    'tabs.queue': 'Ellenőrzési sor',
    'tabs.words': 'Szavak',
    'tabs.config': 'Beállítások',
    'tabs.players': 'Játékosok',

    'common.loading': 'Betöltés...',
    'common.save': 'Mentés',
    'common.saved': 'Mentve.',
    'common.cancel': 'Mégsem',
    'common.search': 'Keresés',
    'common.action': 'Művelet',
    'common.decision': 'Döntés',
    'common.word': 'Szó',
    'common.wordlist': 'Szólista',
    'common.dict': 'Szótár',
    'common.date': 'Dátum',
    'common.activeQ': 'Aktív?',
    'common.yes': 'igen',
    'common.no': 'nem',
    'common.noResults': 'Nincs találat.',
    'common.noData': 'Nincs még elég adat.',
    'common.anonymous': 'névtelen',
    'common.value': 'Érték',
    'common.default': 'Alapérték',
    'common.setting': 'Beállítás',

    'err.invalidToken': 'Érvénytelen token.',
    'err.load': 'Hiba történt a betöltéskor.',
    'err.fetch': 'Hiba történt a lekéréskor.',
    'err.save': 'Hiba történt a mentéskor.',
    'err.search': 'Hiba történt a keresés során.',
    'err.delete': 'Hiba történt a törléskor.',
    'err.mutation': 'Hiba történt a művelet során.',
    'err.details': 'Hiba történt a részletek betöltésekor.',

    'queue.reportsHeader': 'Bejelentett szavak ({{count}})',
    'queue.noReports': 'Nincs nyitott bejelentés.',
    'queue.suggestionsHeader': 'Javasolt szavak ({{count}})',
    'queue.noSuggestions': 'Nincs nyitott javaslat.',
    'queue.firstReport': 'Első bejelentés',
    'queue.reportedNx': '({{count}}x bejelentve)',
    'queue.inactive': 'nem (kikapcsolva)',
    'queue.acceptTitle': 'A bejelentés jogos: a szó törlődik a listáról',
    'queue.accept': 'Törlöm (rossz szó)',
    'queue.rejectTitle': 'A bejelentés alaptalan: a szó marad/visszaáll',
    'queue.reject': 'Megtartom',
    'queue.suggestedBy': 'Javasolta',
    'queue.approve': 'Jóváhagyom',
    'queue.decline': 'Elutasítom',

    'words.searchPlaceholder': 'Keresés a szólistában...',
    'words.source': 'Forrás',
    'words.sourceSuggested': 'javasolt',
    'words.sourceOriginal': 'eredeti',
    'words.edit': 'Szerkesztés',
    'words.delete': 'Törlés',
    'words.confirmDelete': 'Biztosan törlöd: "{{word}}"?',

    'config.propagationNote': 'A módosítások kb. 30 másodperc alatt érnek el minden szervert — nem azonnal mindenhol, mert a beállításokat gyakori lekérdezés helyett gyorsítótárazzuk.',
    'config.hint_cost': 'Segítség ára (pont)',
    'config.completion_bonus_multiplier': 'Teljesítési bónusz szorzó (pont/másodperc)',
    'config.guess_rate_limit_per_second': 'Tippelési sebességkorlát (helyes tipp/mp)',
    'config.min_word_length': 'Legrövidebb elfogadott szó (betű)',
    'config.timer_base_seconds': 'Alap időkeret (másodperc)',
    'config.timer_seconds_per_extra_length': 'Extra idő betűnként a minimum fölött (másodperc)',
    'config.notNumber': '{{label}}: a megadott érték nem szám.',

    'ui.sectionTitle': 'Játékos-felület elemei',
    'ui.sectionNote': 'Egy elrejtett vezérlő a szerveren is rögzítve lesz (a lenti alapértékre), tehát a játék így is indítható. A módosítás ugyanúgy kb. 30 másodperc alatt terjed szét.',
    'ui.show_length_selector': 'Szóhossz-választó látható',
    'ui.show_wordlist_selector': 'Szótárválasztó látható',
    'ui.show_easy_mode': 'Könnyű mód kapcsoló látható',
    'ui.default_length': 'Rögzített szóhossz (ha a választó rejtve van)',
    'ui.default_wordlist': 'Rögzített szótár (ha a választó rejtve van)',
    'ui.visible': 'Látható',
    'ui.hidden': 'Rejtve',
    'ui.lengthOption': '{{n}} betű',

    'dash.openReports': 'Nyitott bejelentés',
    'dash.openSuggestions': 'Nyitott javaslat',
    'dash.games': 'Játékok',
    'dash.dau': 'Aktív játékosok',
    'dash.dailyHeader': 'Játékok / nap és aktív játékosok (utolsó 30 nap)',
    'dash.mostFailedHeader': 'Leggyakrabban elvétett szavak',
    'dash.failed': 'Elvétve',
    'dash.solved': 'Megoldva',
    'dash.hardestHeader': 'Legnehezebb szavak (megoldási arány szerint)',
    'dash.successRate': 'Megoldási arány',
    'dash.attempts': 'Próbálkozások',
    'dash.avgGamesPerPlayer': 'Átlag játék / játékos',
    'dash.avgDuration': 'Átlag játékidő',
    'dash.seconds': 'mp',
    'dash.byMonth': 'Játékok havi bontásban',
    'dash.month': 'Hónap',
    'dash.byQuarter': 'Játékok negyedéves bontásban',
    'dash.quarter': 'Negyedév',
    'dash.byHour': 'Játékok napszak szerint (minden nap összesítve)',
    'dash.hour': 'Óra',
    'dash.byCountry': 'Játékok ország szerint',
    'dash.country': 'Ország',

    'players.header': 'Játékosok',
    'players.searchPlaceholder': 'Keresés név szerint...',
    'players.name': 'Név',
    'players.played': 'Játszott',
    'players.bestScore': 'Legjobb pont',
    'players.registered': 'Regisztrált',
    'players.adminTag': '(admin)',
    'players.rename': 'Átnevezés',
    'players.entriesHeader': 'Ranglista bejegyzések',
    'players.loadEntries': 'Betöltés',
    'players.noEntries': 'Nincs eredmény.',
    'players.player': 'Játékos',
    'players.score': 'Pont',
    'players.length': 'Hossz',
    'players.hintedTitle': 'Segítséggel',
    'players.details': 'Részletek',
    'players.close': 'Bezárás',
    'players.disqualify': 'Törlés a ranglistáról',
    'players.confirmDisqualify': 'Biztosan törlöd ezt az eredményt a ranglistáról?',
    'players.targetWord': 'Célszó:',
    'players.found': 'Megtalált:',
    'players.status': 'Állapot:',
    'players.disqualified': ' (törölve a ranglistáról)',
    'players.gameCountry': 'Ország:',
    'players.countryUnknown': 'ismeretlen',
    'players.guessTimeline': 'Tippek időrendben:',
    'players.noGuesses': 'Nincs rögzített tipp.',
    'players.points': 'pont',
    'players.hintsHeader': 'Segítségek:',
    'players.hintLine': '{{position}}. betű: {{letter}}, -{{cost}} pont',
  },
  en: {
    'app.title': 'Betűvető admin',
    'app.logout': 'Sign out',
    'app.langLabel': 'Language',

    'login.emailLabel': 'Email address',
    'login.emailPlaceholder': 'admin@example.com',
    'login.magicSend': 'Send sign-in link',
    'login.magicSent': 'A sign-in link was sent to {{email}}. Click it in the email to sign in.',
    'login.magicError': "Couldn't send the sign-in link.",
    'login.or': 'or',
    'login.tokenLabel': 'Admin token',
    'login.tokenSubmit': 'Sign in with token',

    'tabs.dashboard': 'Overview',
    'tabs.queue': 'Review queue',
    'tabs.words': 'Words',
    'tabs.config': 'Settings',
    'tabs.players': 'Players',

    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.saved': 'Saved.',
    'common.cancel': 'Cancel',
    'common.search': 'Search',
    'common.action': 'Action',
    'common.decision': 'Decision',
    'common.word': 'Word',
    'common.wordlist': 'Wordlist',
    'common.dict': 'Dictionary',
    'common.date': 'Date',
    'common.activeQ': 'Active?',
    'common.yes': 'yes',
    'common.no': 'no',
    'common.noResults': 'No results.',
    'common.noData': 'Not enough data yet.',
    'common.anonymous': 'anonymous',
    'common.value': 'Value',
    'common.default': 'Default',
    'common.setting': 'Setting',

    'err.invalidToken': 'Invalid token.',
    'err.load': 'Something went wrong loading.',
    'err.fetch': 'Something went wrong fetching.',
    'err.save': 'Something went wrong saving.',
    'err.search': 'Something went wrong searching.',
    'err.delete': 'Something went wrong deleting.',
    'err.mutation': 'Something went wrong during the operation.',
    'err.details': 'Something went wrong loading the details.',

    'queue.reportsHeader': 'Reported words ({{count}})',
    'queue.noReports': 'No open reports.',
    'queue.suggestionsHeader': 'Suggested words ({{count}})',
    'queue.noSuggestions': 'No open suggestions.',
    'queue.firstReport': 'First reported',
    'queue.reportedNx': '(reported {{count}}x)',
    'queue.inactive': 'no (disabled)',
    'queue.acceptTitle': 'The report is valid: the word is removed from the list',
    'queue.accept': 'Remove (wrong word)',
    'queue.rejectTitle': 'The report is unfounded: the word stays / is restored',
    'queue.reject': 'Keep it',
    'queue.suggestedBy': 'Suggested by',
    'queue.approve': 'Approve',
    'queue.decline': 'Decline',

    'words.searchPlaceholder': 'Search the wordlist...',
    'words.source': 'Source',
    'words.sourceSuggested': 'suggested',
    'words.sourceOriginal': 'original',
    'words.edit': 'Edit',
    'words.delete': 'Delete',
    'words.confirmDelete': 'Really delete: "{{word}}"?',

    'config.propagationNote': 'Changes reach every server in about 30 seconds — not instantly everywhere, because settings are cached rather than re-queried on every request.',
    'config.hint_cost': 'Hint cost (points)',
    'config.completion_bonus_multiplier': 'Completion bonus multiplier (points/second)',
    'config.guess_rate_limit_per_second': 'Guess rate limit (correct guesses/sec)',
    'config.min_word_length': 'Shortest accepted word (letters)',
    'config.timer_base_seconds': 'Base time limit (seconds)',
    'config.timer_seconds_per_extra_length': 'Extra time per letter above the minimum (seconds)',
    'config.notNumber': '{{label}}: the value is not a number.',

    'ui.sectionTitle': 'Player-facing controls',
    'ui.sectionNote': "A hidden control is also pinned server-side (to the default below), so a game still starts fine. The change propagates in about 30 seconds, same as above.",
    'ui.show_length_selector': 'Word-length selector visible',
    'ui.show_wordlist_selector': 'Wordlist selector visible',
    'ui.show_easy_mode': 'Easy-mode toggle visible',
    'ui.default_length': 'Pinned word length (when the selector is hidden)',
    'ui.default_wordlist': 'Pinned wordlist (when the selector is hidden)',
    'ui.visible': 'Visible',
    'ui.hidden': 'Hidden',
    'ui.lengthOption': '{{n}} letters',

    'dash.openReports': 'Open reports',
    'dash.openSuggestions': 'Open suggestions',
    'dash.games': 'Games',
    'dash.dau': 'Active players',
    'dash.dailyHeader': 'Games/day and active players (last 30 days)',
    'dash.mostFailedHeader': 'Most-missed words',
    'dash.failed': 'Missed',
    'dash.solved': 'Solved',
    'dash.hardestHeader': 'Hardest words (by success rate)',
    'dash.successRate': 'Success rate',
    'dash.attempts': 'Attempts',
    'dash.avgGamesPerPlayer': 'Avg games / player',
    'dash.avgDuration': 'Avg game time',
    'dash.seconds': 's',
    'dash.byMonth': 'Games by month',
    'dash.month': 'Month',
    'dash.byQuarter': 'Games by quarter',
    'dash.quarter': 'Quarter',
    'dash.byHour': 'Games by hour of day (all days combined)',
    'dash.hour': 'Hour',
    'dash.byCountry': 'Games by country',
    'dash.country': 'Country',

    'players.header': 'Players',
    'players.searchPlaceholder': 'Search by name...',
    'players.name': 'Name',
    'players.played': 'Played',
    'players.bestScore': 'Best score',
    'players.registered': 'Registered',
    'players.adminTag': '(admin)',
    'players.rename': 'Rename',
    'players.entriesHeader': 'Leaderboard entries',
    'players.loadEntries': 'Load',
    'players.noEntries': 'No entries.',
    'players.player': 'Player',
    'players.score': 'Score',
    'players.length': 'Length',
    'players.hintedTitle': 'Used a hint',
    'players.details': 'Details',
    'players.close': 'Close',
    'players.disqualify': 'Remove from leaderboard',
    'players.confirmDisqualify': 'Really remove this score from the leaderboard?',
    'players.targetWord': 'Target word:',
    'players.found': 'Found:',
    'players.status': 'Status:',
    'players.disqualified': ' (removed from leaderboard)',
    'players.gameCountry': 'Country:',
    'players.countryUnknown': 'unknown',
    'players.guessTimeline': 'Guesses in order:',
    'players.noGuesses': 'No recorded guesses.',
    'players.points': 'pts',
    'players.hintsHeader': 'Hints:',
    'players.hintLine': 'letter {{position}}: {{letter}}, -{{cost}} pts',
  },
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return SUPPORTED.includes(v) ? v : 'hu'
  } catch {
    return 'hu'
  }
}

function translate(lang, key, vars) {
  const table = STRINGS[lang] || STRINGS.hu
  let out = table[key] ?? STRINGS.hu[key] ?? key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{{${name}}}`, String(value))
    }
  }
  return out
}

export const AdminLangContext = createContext({ lang: 'hu', setLang: () => {}, t: (k) => k })

/** Non-component exports live here (the provider component is in AdminLangProvider.jsx)
 *  so this file stays free of the react-refresh "components only" rule. */
export { STORAGE_KEY, SUPPORTED, readStored, translate }

export function useAdminT() {
  return useContext(AdminLangContext)
}

/** BCP-47 locale for Date#toLocaleString etc., derived from the admin language. */
export function adminLocale(lang) {
  return lang === 'en' ? 'en-GB' : 'hu-HU'
}

export const ADMIN_LANGUAGES = [
  { code: 'hu', label: 'Magyar' },
  { code: 'en', label: 'English' },
]
