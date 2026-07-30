import { useCallback, useEffect, useState } from 'react'

// Read-only overview (ROADMAP 5.2 item 4): games/day + DAU for the trailing 30 days,
// most-failed words, and open report/suggestion counts. Plain table, no chart library —
// same "no component library" call as the rest of the admin shell (5.1).
export default function AdminDashboardPanel({ token, onAuthError }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/dashboard', {
        headers: { 'x-admin-token': token },
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setStats(await response.json())
    } catch (err) {
      setError(err.message || 'Hiba történt a betöltéskor.')
    } finally {
      setLoading(false)
    }
  }, [token, onAuthError])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !stats) return <p className="text-sm text-game-primary/70">Betöltés...</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!stats) return null

  const maxGames = Math.max(1, ...stats.daily.map((d) => d.games))

  return (
    <div>
      <section className="mb-8 grid grid-cols-2 gap-4 max-w-md">
        <div className="bg-white border-2 border-game-border rounded-lg p-4 shadow">
          <div className="text-sm text-game-primary/60">Nyitott bejelentés</div>
          <div className="text-2xl font-extrabold text-game-primary">{stats.queue_size.reports}</div>
        </div>
        <div className="bg-white border-2 border-game-border rounded-lg p-4 shadow">
          <div className="text-sm text-game-primary/60">Nyitott javaslat</div>
          <div className="text-2xl font-extrabold text-game-primary">{stats.queue_size.suggestions}</div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Játékok / nap és aktív játékosok (utolsó 30 nap)</h2>
        <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
          <thead>
            <tr className="text-left border-b-2 border-game-border bg-blue-50">
              <th className="py-2 px-2">Dátum</th>
              <th className="py-2 px-2">Játékok</th>
              <th className="py-2 px-2">Aktív játékosok</th>
              <th className="py-2 px-2 w-1/2">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {stats.daily.map((d) => (
              <tr key={d.date} className="border-b border-game-border/40">
                <td className="py-2 px-2">{d.date}</td>
                <td className="py-2 px-2 font-semibold">{d.games}</td>
                <td className="py-2 px-2">{d.dau}</td>
                <td className="py-2 px-2">
                  <div className="bg-game-secondary/20 rounded h-3">
                    <div
                      className="bg-game-secondary rounded h-3"
                      style={{ width: `${(d.games / maxGames) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Leggyakrabban elvétett szavak</h2>
        {stats.most_failed_words.length === 0 ? (
          <p className="text-sm text-game-primary/60">Nincs még elég adat.</p>
        ) : (
          <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
            <thead>
              <tr className="text-left border-b-2 border-game-border bg-blue-50">
                <th className="py-2 px-2">Szó</th>
                <th className="py-2 px-2">Szótár</th>
                <th className="py-2 px-2">Elvétve</th>
                <th className="py-2 px-2">Megoldva</th>
              </tr>
            </thead>
            <tbody>
              {stats.most_failed_words.map((w) => (
                <tr key={`${w.wordlist}-${w.word}`} className="border-b border-game-border/40">
                  <td className="py-2 px-2 font-semibold">{w.word}</td>
                  <td className="py-2 px-2">{w.wordlist}</td>
                  <td className="py-2 px-2">{w.times_failed}</td>
                  <td className="py-2 px-2">{w.times_solved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ROADMAP Batch 10 "difficulty rating per word": ranked by success rate rather than
          raw fail count, and requires a minimum sample (lib/word-stats.ts) so a word tried
          only once or twice can't look artificially unbeatable. */}
      <section>
        <h2 className="text-lg font-bold mb-2">Legnehezebb szavak (megoldási arány szerint)</h2>
        {stats.hardest_words.length === 0 ? (
          <p className="text-sm text-game-primary/60">Nincs még elég adat.</p>
        ) : (
          <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
            <thead>
              <tr className="text-left border-b-2 border-game-border bg-blue-50">
                <th className="py-2 px-2">Szó</th>
                <th className="py-2 px-2">Szótár</th>
                <th className="py-2 px-2">Megoldási arány</th>
                <th className="py-2 px-2">Próbálkozások</th>
              </tr>
            </thead>
            <tbody>
              {stats.hardest_words.map((w) => (
                <tr key={`${w.wordlist}-${w.word}`} className="border-b border-game-border/40">
                  <td className="py-2 px-2 font-semibold">{w.word}</td>
                  <td className="py-2 px-2">{w.wordlist}</td>
                  <td className="py-2 px-2">{Math.round(w.success_rate * 100)}%</td>
                  <td className="py-2 px-2">{w.times_solved + w.times_failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
