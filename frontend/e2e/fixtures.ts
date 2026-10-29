/**
 * ROADMAP 16.8 — every E2E test also checks the Content-Security-Policy. `vite preview` sends
 * the same CSP headers as production (vite.config.js reads them from vercel.json), and this
 * fixture records each `securitypolicyviolation` event the page fires, across navigations,
 * then fails the test if there was one. Report-Only violations fire the same event, which is
 * what lets the policy be proven here before it is switched to enforcing.
 */
import { expect, test as base } from '@playwright/test'

export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [
    async ({ page }, use) => {
      const violations: string[] = []
      // exposeBinding survives navigations; the init script re-attaches the listener on
      // every new document before any page script runs.
      await page.exposeBinding('__reportCspViolation', (_source, text: string) => {
        violations.push(text)
      })
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          const report = (window as unknown as { __reportCspViolation: (t: string) => void }).__reportCspViolation
          report(`${e.disposition} ${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} on ${e.documentURI}`)
        })
      })
      await use()
      expect(violations, 'Content-Security-Policy violations').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
