import { useCallback, useEffect, useState } from 'react'

// ROADMAP Batch 10 item 13: one small reusable table+bar component for any bucketed
// games/DAU series (month, quarter, hour-of-day) — same CSS-bar pattern the daily series
// below already uses, factored out once it's needed a third time.
function BucketBarTable({ rows, bucketLabel, formatBucket }) {
  const maxGames = Math.max(1, ...rows.map((r) => r.games))
  return (
    <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
      <thead>
        <tr className="text-left border-b-2 border-game-border bg-blue-50">
          <th className="py-2 px-2">{bucketLabel}</th>
          <th className="py-2 px-2">Játékok</th>
          <th className="py-2 px-2">Aktív játékosok</th>
          <th className="py-2 px-2 w-1/2">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bucket} className="border-b border-game-border/40">
            <td className="py-2 px-2">{formatBucket ? formatBucket(r.bucket) : r.bucket}</td>
            <td className="py-2 px-2 font-semibold">{r.games}</td>
            <td className="py-2 px-2">{r.dau}</td>
            <td className="py-2 px-2">
              <div className="bg-game-secondary/20 rounded h-3">
                <div
                  className="bg-game-secondary rounded h-3"
                  style={{ width: `${(r.games / maxGames) * 100}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Read-only overview (ROADMAP 5.2 item 4): games/day + DAU for the trailing 30 days,
// most-failed words, open report/suggestion counts, plus the Batch 10 item 13 player-stat
// drill-down (avg games/duration per player, time-bucketed views, country distribution).
// Plain tables, no chart library — same "no component library" call as the rest of the
// admin shell (5.1).
export default function AdminDashboardPanel({ authHeaders, onAuthError }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/dashboard', {
        headers: authHeaders,
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
  }, [authHeaders, onAuthError])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !stats) return <p className="text-sm text-game-primary/70">Betöltés...</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!stats) return null

  const maxGames = Math.max(1, ...stats.daily.map((d) => d.games))
  const maxCountryGames = Math.max(1, ...stats.countries.map((c) => c.games))

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
      <section className="mb-8">
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

      {/* ROADMAP Batch 10 item 13: player-stat drill-down. avg_game_duration_seconds is a
          two-level average (each player's own average, then averaged across players) so
          one hyperactive player's game count can't dominate the figure — see
          lib/admin-dashboard.ts's own comment for why. Only games that reached a real
          terminal outcome (finished/given_up/expired) count toward either number. */}
      <section className="mb-8 grid grid-cols-2 gap-4 max-w-md">
        <div className="bg-white border-2 border-game-border rounded-lg p-4 shadow">
          <div className="text-sm text-game-primary/60">Átlag játék / játékos</div>
          <div className="text-2xl font-extrabold text-game-primary">
            {stats.player_stats.avg_games_per_player.toFixed(1)}
          </div>
        </div>
        <div className="bg-white border-2 border-game-border rounded-lg p-4 shadow">
          <div className="text-sm text-game-primary/60">Átlag játékidő</div>
          <div className="text-2xl font-extrabold text-game-primary">
            {Math.round(stats.player_stats.avg_game_duration_seconds)} mp
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Játékok havi bontásban</h2>
        <BucketBarTable rows={stats.games_by_month} bucketLabel="Hónap" />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Játékok negyedéves bontásban</h2>
        <BucketBarTable rows={stats.games_by_quarter} bucketLabel="Negyedév" />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">Játékok napszak szerint (minden nap összesítve)</h2>
        <BucketBarTable
          rows={stats.games_by_hour}
          bucketLabel="Óra"
          formatBucket={(b) => `${b.padStart(2, '0')}:00`}
        />
      </section>

      {/* Country-level only (Vercel's request geo header, no GeoIP service) — deliberately
          not city/coordinate-level, per the scope decision in ROADMAP Batch 10 item 13.
          UNKNOWN covers games from before this shipped, plus any request without the
          header (local dev). */}
      <section>
        <h2 className="text-lg font-bold mb-2">Játékok ország szerint</h2>
        <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
          <thead>
            <tr className="text-left border-b-2 border-game-border bg-blue-50">
              <th className="py-2 px-2">Ország</th>
              <th className="py-2 px-2">Játékok</th>
              <th className="py-2 px-2 w-1/2">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {stats.countries.map((c) => (
              <tr key={c.country} className="border-b border-game-border/40">
                <td className="py-2 px-2 font-semibold">{c.country}</td>
                <td className="py-2 px-2">{c.games}</td>
                <td className="py-2 px-2">
                  <div className="bg-game-secondary/20 rounded h-3">
                    <div
                      className="bg-game-secondary rounded h-3"
                      style={{ width: `${(c.games / maxCountryGames) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
