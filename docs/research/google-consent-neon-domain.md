# Google sign-in shows "neon.tech": why, and how to fix it

Date: 2026-11-11

## Summary

Two separate things put "neon.tech" on the Google screen.

- **The hostname comes from the redirect URI.** The OAuth redirect URI is Neon Auth's callback route, `{NEON_AUTH_BASE_URL}/callback/google`, and that host is on neon.tech. Neon's own docs say Google's "Continue to" label uses the hostname from that redirect URI ([Neon: Google OAuth branding](https://neon.com/docs/auth/guides/setup-oauth#google-oauth-branding)).
- **Our name only replaces it after brand verification.** Google shows the app name and logo only once the brand is verified: "Without verification, only your application domain will be visible to users" ([Google: Manage OAuth App Branding](https://support.google.com/cloud/answer/15549049?hl=en)). Publishing the consent screen to production does not by itself verify the brand.

So the first fix to try is brand verification, which needs no code change. The catch is that Google's rules say every authorized domain, including the domain of each redirect URI, must be verified as ours in Search Console ([Google: Submit for brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). We cannot verify neon.tech.

- Users of a similar hosted-auth service (Supabase) report that Google approved them anyway after they explained that the redirect domain belongs to their auth provider. That evidence is anecdotal.
- Neon Auth has **no documented custom-domain option** for its auth endpoints.
- Neon's docs say that even its own auth proxy still sends Google to the neon.tech callback, so a Vercel rewrite cannot change what Google shows.

If verification is refused, the fallback is a code change, and it is unverified on Neon: get the Google ID token in the browser on our own domain (Google Identity Services) and hand it to Neon Auth with `signIn.social({ provider: 'google', idToken })`. That takes the neon.tech redirect out of the flow entirely.

---

## Q1. What Google shows on the consent screen and account chooser, and when

**Verified from source:**

- **Name and logo need a verified brand.** "Your brand must be verified if you want your application logo and application name to be visible to users on the consent screen. Without verification, only your application domain will be visible to users." ([Google: Manage OAuth App Branding](https://support.google.com/cloud/answer/15549049?hl=en))
- **Who must verify.** An app needs brand verification if it is "configured for external users and displays a logo or display name on the OAuth consent screen" ([Google: brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)).
- **Which domain is "the application domain".** For a Neon Auth setup, Neon says: "Google shows a **Continue to** label that uses the hostname from your OAuth redirect URI …, typically the Neon-managed host from your `NEON_AUTH_BASE_URL`" ([Neon: Google OAuth branding](https://neon.com/docs/auth/guides/setup-oauth#google-oauth-branding)). Neon's troubleshooting page says the same: "That hostname comes from the OAuth redirect URI (your app vs Managed Better Auth)" ([Neon: troubleshooting](https://neon.com/docs/auth/troubleshooting)).
- **The "unverified app" warning is a different screen.** It appears when an app uses sensitive or restricted scopes without verification, and it caps the app at 100 new users ([Google: Unverified apps](https://support.google.com/cloud/answer/7454865?hl=en)). Sign-in uses only `openid`, `email` and `profile`, so this warning should not apply to us.
  - **Unverified:** that page does not explicitly list `openid`/`email`/`profile` as exempt. This point is inferred from the page tying the warning to sensitive and restricted scopes.

**Unverified, from community reports, not Google docs:**

- After brand verification, the "continue to" line shows the app name instead of the auth provider's domain. Several Supabase users report exactly this ([Supabase discussion #2925](https://github.com/orgs/supabase/discussions/2925)). Auth0 community threads describe the same domain-versus-name behaviour ([Auth0 community](https://community.auth0.com/t/changing-the-message-choose-an-account-to-continue-to-auth0-com-on-sign-in-with-google/118884)). Google has no page that spells out the exact "Choose an account to continue to X" rule.

**What this means for us:** If the brand were verified, the screen should read "Betűvető" (the configured app name) rather than neon.tech. Seeing neon.tech means the brand is not verified yet, or the verified branding has not been published.

## Q2. Brand verification requirements, and whether a neon.tech redirect blocks it

**Verified from source.** These are Google's requirements:

| Requirement | What Google says |
|---|---|
| Authorized domains | Must contain the top private domains of the home page, privacy policy and terms of service. They "also need to include the redirect URIs or JavaScript origins" of Web-application clients ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). "All domains used in your project, whether in the branding page or client configuration pages must be pre-registered here" ([15549049](https://support.google.com/cloud/answer/15549049?hl=en)). |
| Domain ownership | "You must verify that you own all domains listed in your Authorized domains section", via Google Search Console, by a project Owner or Editor ([Verification requirements](https://support.google.com/cloud/answer/13464321?hl=en)). The verification must be done by "a Google account that is currently a Project Owner" ([Domain Verification](https://support.google.com/cloud/answer/13804266?hl=en)). |
| Home page | "Must be hosted on a verified domain you own", must "accurately represent and identify your app", "can not be only a login page", and must link the same privacy policy as the consent screen ([13464321](https://support.google.com/cloud/answer/13464321?hl=en)). |
| Privacy policy | "Should be hosted within the domain that hosts your homepage", must be the same link on the home page and the consent screen, and must say how the app uses Google user data ([13464321](https://support.google.com/cloud/answer/13464321?hl=en); [brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). |
| Logo / name changes | Changing the name or logo needs a new verification request ([Brand approvals](https://support.google.com/cloud/answer/16868008?hl=en)). Edits are saved as "Draft Branding" until published ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). |
| Timeline | Automated check: "typically takes a few minutes after you click the Verify Branding button". Manual review: "usually takes 2-3 business days". A passing result is valid for 7 days, so publish within that window ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification); [15549049](https://support.google.com/cloud/answer/15549049?hl=en)). |
| Domain cap | At most 10 authorized domains can be verified ([13804266](https://support.google.com/cloud/answer/13804266?hl=en)). |

**Does the neon.tech redirect URI block verification?**

- **Going by Google's written rules: yes, in principle.** The redirect URI's domain must be an authorized domain, and every authorized domain must be verified in Search Console. We cannot verify neon.tech. Google's own help also lists "A project owner has not yet verified one or more of your authorized domains" as a verification issue ([13804266](https://support.google.com/cloud/answer/13804266?hl=en)).
- **In practice: Unverified (anecdotal).** In the Supabase thread, people with `*.supabase.co` redirect URIs did several things:
  - They removed the third-party domain from the Authorized domains list while keeping it in the client's redirect URIs.
  - Google initially rejected some of them, citing "multiple unique domains". Others were approved after explaining that it belongs to a third-party auth provider (2021–2022).
  - One user reported automatic verification "in less than 15 minutes" in February 2026, but did not describe their redirect setup.

  Source: [Supabase discussion #2925](https://github.com/orgs/supabase/discussions/2925).
- **Unverified:** whether today's Google Auth Platform console lets you remove neon.tech from Authorized domains while a client still lists a neon.tech redirect URI. Also unverified: how the automated "Verify Branding" check treats it.

**Does "continue to X" still come from the redirect host after verification?** No primary source says so. Google's page says the name and logo become visible once the brand is verified ([15549049](https://support.google.com/cloud/answer/15549049?hl=en)). Community reports say the app name then replaces the domain ([Supabase #2925](https://github.com/orgs/supabase/discussions/2925)). **Unverified** for our exact setup until it is tried.

## Q3. Can Neon Auth use our own domain, or can we proxy it?

**Custom domain for Neon Auth: not documented.**

- **What we searched.** We found no Neon page, API field or GitHub issue offering a custom domain for the Neon Auth endpoints or the OAuth callback. Searched:
  - Neon docs: [Set up OAuth](https://neon.com/docs/auth/guides/setup-oauth), [Configure trusted domains](https://neon.com/docs/auth/guides/configure-domains), [Troubleshooting](https://neon.com/docs/auth/troubleshooting), [Production checklist](https://neon.com/docs/auth/production-checklist), [Roadmap](https://neon.com/docs/auth/roadmap), [Plugins](https://neon.com/docs/auth/guides/plugins), and the full [Auth API reference](https://neon.com/docs/reference/api/auth) endpoint list.
  - GitHub issue and code search in `neondatabase/neon-js`, `neondatabase/neon-pkgs` and `neondatabase/website`.
- **"Trusted domains" is not a custom domain.** It is only a redirect allowlist for `callbackURL` ([Configure trusted domains](https://neon.com/docs/auth/guides/configure-domains)).
- **The OAuth provider settings cannot change the redirect.** The Neon API accepts `client_id`, `client_secret` and a few Microsoft/Apple fields, and nothing for a redirect URI or base URL ([Auth API reference](https://neon.com/docs/reference/api/auth)).
- **The only general config setting is unrelated.** The single `PATCH …/auth/config` field is the application name used in auth emails.
- **Neon Functions do have custom domains, but those are unrelated to Auth.**

**Proxying through betuveto.tmsso.com: not viable for the Google redirect (verified from docs, not tested).**

- Neon's docs state that whether you use their Next.js auth proxy or call Managed Better Auth from the browser, "the provider redirects to `{NEON_AUTH_BASE_URL}/callback/{provider}` for that branch" ([Set up OAuth](https://neon.com/docs/auth/guides/setup-oauth)).
- The `redirect_uri` is built by Neon's server from its own base URL. A Vercel rewrite of `/api/auth/*` to Neon would therefore not change what Neon sends to Google.
- **Inferred (Unverified):** Google also requires the same `redirect_uri` in the token exchange. A callback that arrived on our host but that Neon exchanged with its own URI would likely fail with `redirect_uri_mismatch`.
- The installed SDK (`@neondatabase/auth` 0.5.0-beta) has a server proxy toolkit (`handleAuthProxyRequest`, `createAuthServer`). But its OAuth return still uses Neon's `neon_auth_session_verifier` hand-back after the callback on Neon's host. This is visible in the package's `dist` code, and our `googleAccount.js` already strips that parameter.
- **Better Auth itself can do this, but Neon doesn't expose it.** Self-hosted Better Auth lets you set `baseURL` (static, or dynamic with `allowedHosts`) and a per-provider `redirectURI` ([Better Auth options](https://www.better-auth.com/docs/reference/options); [Better Auth OAuth](https://www.better-auth.com/docs/concepts/oauth)). Its [`oAuthProxy` plugin](https://www.better-auth.com/docs/plugins/oauth-proxy) is meant for previews and development, and has to be installed on a production server you run. Neon Auth exposes a fixed plugin subset that does not include `oAuthProxy` ([Neon plugins](https://neon.com/docs/auth/guides/plugins)), and it has no `baseURL` or `redirectURI` setting.
- **Cookie note:** Better Auth's OAuth state is tied to the host that starts the flow. A proxy would have to keep start and callback on the same host.
  - Neon's roadmap says that setups where frontend and backend sit on different domains "are not yet supported", because of HTTP-only session cookies ([Neon roadmap](https://neon.com/docs/auth/roadmap)).
  - That is a further reason not to build a partial proxy.

**A real alternative that avoids the neon.tech redirect: Google ID-token sign-in.**

- **What Better Auth supports.** Better Auth supports `signIn.social({ provider: "google", idToken: { token } })`. In that case "no redirection will happen, and the user will be signed in directly" ([Better Auth: Google](https://www.better-auth.com/docs/authentication/google)).
- **What the Neon SDK does.** The installed Neon SDK calls exactly this in its Supabase-compatibility adapter (`signInWithIdToken` → `signIn.social({ provider, idToken })`). That suggests Neon's server accepts it.
- **Unverified:** whether Neon's managed server accepts Google ID tokens with the project's own client ID. Neon's docs do not mention it.
- **Where the ID token would come from.** It would come from [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) (the "Sign in with Google" button or popup) running on betuveto.tmsso.com. That flow uses Authorized JavaScript origins instead of a neon.tech redirect URI.
- **What GIS displays.** Google says that with FedCM in Chrome "the top-level Authorized domain is displayed during user consent", and otherwise "the Application name is displayed" ([GIS setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)). In Chrome users would see tmsso.com, not neon.tech.
  - This applies to GIS only, not to today's redirect flow.

## Q4. Recommended path

### Steps for the project owner (no code change)

1. **Check the current state.** In Google Cloud Console, open Google Auth Platform → Branding.
   - Note the verification status: a **Verify Branding** button, "Ready to publish", "Need to re-verify", or issues listed.
   - Note what is in **Authorized domains**: tmsso.com only, or neon.tech too.
2. **Verify tmsso.com in Google Search Console.** Use a DNS TXT record in Cloudflare. Do it with the Google account that is an **Owner** of the Cloud project ([Domain Verification](https://support.google.com/cloud/answer/13804266?hl=en)).
3. **Check the branding fields against Google's rules:**
   - Home page: `https://betuveto.tmsso.com/`. The game itself, not only a login page.
   - Privacy policy: `https://betuveto.tmsso.com/privacy`. Same domain, linked from the home page, and it must mention how Google account data (the email) is used.
   - App name: exactly as shown on the home page. Check "Betűvető" versus "Betuveto" spelling consistency, because a name mismatch with the home page is a reported rejection reason ([Google developer forum](https://discuss.google.dev/t/brand-verification-the-consent-screen-shows-our-domain-not-the-configured-app-name-is-that-the-string-compared-against-the-home-page/388051)).
   - Scopes: only `openid`, `email`, `profile`.
4. **Click Verify Branding.**
   - If it reports a problem with neon.tech as an authorized domain, try removing neon.tech from Authorized domains (empty the field, then delete the row), keeping the redirect URI on the OAuth client. Then verify again.
   - If it then goes to manual review or is rejected, use "Request additional review". Explain that the neon.tech callback belongs to Neon, the third-party authentication provider, and that the app's own domain is tmsso.com. This is the path Supabase users report working ([Supabase #2925](https://github.com/orgs/supabase/discussions/2925)).
5. **Publish the branding.** When the status shows "Ready to publish", click **Publish branding** within 7 days ([15549049](https://support.google.com/cloud/answer/15549049?hl=en)).
6. **Test the result.** Sign in with a Google account in a private window and check that the screen names Betűvető instead of neon.tech.
7. **Next step depends on the outcome.** If Google refuses verification for good, decide whether to launch with "neon.tech" showing or ask Claude to build the fallback below. Launching with "neon.tech" works for all users, because publishing already lifted the test-user limit and no sensitive scopes are involved.

### What Claude would build if verification fails (fallback, needs a preview test first)

- **Swap the sign-in call.** Replace the redirect call in `startGoogleSignIn()` (`frontend/src/googleAccount.js`) with the Google Identity Services button or popup. Pass the returned ID token to `authClient.signIn.social({ provider: 'google', idToken: { token } })`.
- **Keep the rest unchanged.** That includes the JWT and `/api/v1/account/link` steps.
- **Google Cloud:** add `https://betuveto.tmsso.com` (and the preview/localhost origins) as Authorized JavaScript origins. Once nothing uses it, the neon.tech redirect URI and authorized domain can be removed, which leaves only tmsso.com to verify.
- **CSP:** the GIS script loads from `accounts.google.com`. That conflicts with the planned `script-src 'self'` CSP enforcement (currently report-only in `vercel.json`), which would need an exception.
- **Risks (Unverified):**
  - Whether Neon's server accepts the ID token with our own client ID.
  - Whether the Neon session cookie and `getSession()` then work from our origin in Safari, given that the session now starts with a cross-site fetch instead of a top-level redirect.
  - Both must be proven on a Vercel preview with a Neon branch before production.

### Verified vs inferred

| Claim | Status |
|---|---|
| Unverified brand shows only the domain; verified shows name and logo | Verified (Google) |
| The domain shown is the redirect URI host (neon.tech here) | Verified (Neon docs) |
| Redirect URI domains must be authorized domains, and authorized domains must be Search Console–verified | Verified (Google) |
| Google may still approve with a third-party redirect domain after an explanation | Unverified (community reports) |
| After verification, "continue to" shows the app name | Unverified (community reports) |
| Neon Auth has no custom domain for auth endpoints | Verified as "not documented" (searched docs, API reference, GitHub) |
| A proxy or rewrite can't change the Google redirect host | Verified from Neon docs; the token-exchange failure detail is inferred |
| Neon's server accepts Google ID-token sign-in | Unverified (only implied by the SDK's own adapter code) |

## Sources

All accessed 2026-11-11.

- Google Cloud Help: Manage OAuth App Branding. https://support.google.com/cloud/answer/15549049?hl=en
- Google Cloud Help: Verification requirements. https://support.google.com/cloud/answer/13464321?hl=en
- Google Cloud Help: Submitting your app for verification. https://support.google.com/cloud/answer/13461325?hl=en
- Google Cloud Help: Domain Verification. https://support.google.com/cloud/answer/13804266?hl=en
- Google Cloud Help: Brand Approvals & Auto-Cancellations. https://support.google.com/cloud/answer/16868008?hl=en
- Google Cloud Help: Unverified apps. https://support.google.com/cloud/answer/7454865?hl=en
- Google for Developers: Submit for brand verification. https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- Google for Developers: Sign in with Google, Setup (GIS client ID, FedCM display). https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- Google Developer forum: Brand verification, consent screen shows our domain. https://discuss.google.dev/t/brand-verification-the-consent-screen-shows-our-domain-not-the-configured-app-name-is-that-the-string-compared-against-the-home-page/388051
- Neon docs: Set up OAuth (incl. Google OAuth branding). https://neon.com/docs/auth/guides/setup-oauth
- Neon docs: Auth troubleshooting. https://neon.com/docs/auth/troubleshooting
- Neon docs: Configure trusted domains. https://neon.com/docs/auth/guides/configure-domains
- Neon docs: Auth production checklist. https://neon.com/docs/auth/production-checklist
- Neon docs: Managed Better Auth roadmap. https://neon.com/docs/auth/roadmap
- Neon docs: Plugins. https://neon.com/docs/auth/guides/plugins
- Neon API reference: Authentication. https://neon.com/docs/reference/api/auth
- Better Auth docs: Options (baseURL, trustedOrigins). https://www.better-auth.com/docs/reference/options
- Better Auth docs: OAuth concepts (redirectURI). https://www.better-auth.com/docs/concepts/oauth
- Better Auth docs: Google (ID token sign-in). https://www.better-auth.com/docs/authentication/google
- Better Auth docs: OAuth Proxy plugin. https://www.better-auth.com/docs/plugins/oauth-proxy
- Supabase GitHub discussion #2925: Change displayed redirect URL. https://github.com/orgs/supabase/discussions/2925
- Auth0 community: "Choose an account to continue to auth0.com". https://community.auth0.com/t/changing-the-message-choose-an-account-to-continue-to-auth0-com-on-sign-in-with-google/118884
- Local repo: `frontend/src/neonAuth.js`, `frontend/src/googleAccount.js`, `frontend/package.json` (`@neondatabase/auth` ^0.5.0-beta, installed 0.5.0-beta), and the installed package's `dist` (server proxy toolkit, `signInWithIdToken` in the Supabase adapter).
