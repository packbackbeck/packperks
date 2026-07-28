# Auth / Identity Provider Requirements for PackPerks

This document lists what PackPerks needs from a **user authentication and identity provider** (the service that signs people in, keeps them signed in, and protects their data). It is meant for evaluating our current provider or comparing a new one.

PackPerks currently uses **Supabase Auth** (plus Supabase Postgres with Row Level Security) as the reference implementation, so every item below is something PackPerks already relies on or could adopt.

### Two very different sides

- **Admin console** (`/admin`): staff sign in with a real account. This side needs the full set of required features below.
- **Customer app** (the store pages): customers use the app **without an account**. They are identified by an anonymous device id, and the database still keeps each person to their own data. A full login is optional for customers and only used if a session happens to exist.

### How to read the table

The last column answers "does PackPerks need this to run?"

- **✅ Yes** = required. PackPerks cannot work correctly without it.
- **⬜ No** = optional. Nice to have, or useful later, but not needed today.

---

## Feature table

| Feature | What it does / why PackPerks needs it | Simple example | Required? |
|---|---|---|---|
| **Email + password sign-in** | Lets admins sign in to the console with an email and a password. | An admin types `beke@packback.network` + password and lands on the dashboard. | ✅ Yes |
| **Sign-up with email verification (one-time code)** | New admins register, and a code sent to their inbox proves the email is really theirs. | New admin enters email + password, receives a 6-digit code, types it in to activate the account. | ✅ Yes |
| **Password reset by email** | "Forgot password" sends a secure link so a locked-out admin can set a new password. | Admin clicks the reset link in their inbox and chooses a new password. | ✅ Yes |
| **Update own credentials (change password / email)** | Admins can change their own password or email from inside the app. | Admin opens account settings and updates their password. | ✅ Yes |
| **Sessions with tokens (stay signed in, auto-refresh)** | Keeps admins logged in across page reloads without retyping the password, and refreshes quietly in the background. | Admin refreshes the page an hour later and is still signed in. | ✅ Yes |
| **Server-side token verification** | Our backend functions can trust "who is calling" by checking the signed token, instead of believing whatever the browser claims. | The `bootstrap-admin` function reads the verified user from the token to grant the correct role. | ✅ Yes |
| **Configurable site URL + redirect allow-list** | Controls where verification and reset emails send people back to, so links go to `perks.packback.network` and not `localhost`. | A password-reset email opens `perks.packback.network/admin#reset`. | ✅ Yes |
| **Anonymous / guest access** | Customers can use the app and earn cups with no sign-up at all, identified by a device id. | A customer scans a cup and sees their balance without ever creating an account. | ✅ Yes |
| **Row Level Security (per-row data rules)** | The data store restricts each person to their own rows, while admins can see everything. | Customer A can never read Customer B's claims or balance. | ✅ Yes |
| **Service-role / admin API (privileged server key)** | Backend functions can safely create, read, or update any user for trusted operations. | The account-merge function joins two customer records using a privileged key. | ✅ Yes |
| **User records we can attach roles + profile to** | A stable user id we can key our own tables to (roles, display name, avatar). | An admin's `admin_profiles` row (role = owner/admin/manager/checker) is keyed by their user id. | ✅ Yes |
| **Programmatic control over who can register** | We can block or role-gate new sign-ups by rule, enforced on the server. | Only `@packback.network` emails can self-register as admins; a `gmail.com` sign-up is rejected. | ✅ Yes |
| **Rate limiting on auth endpoints** | Slows down brute-force guessing of passwords or codes. | After several wrong codes the user sees "please wait a minute and try again." | ✅ Yes |
| **Client SDK or API for browser and server** | A library we can call from the React app and from edge functions. | The login page calls `signInWithPassword(email, password)`. | ✅ Yes |
| **Social / OAuth login (Google, Apple, etc.)** | One-click sign-in with an existing account. PackPerks removed the Google button, so this is not needed now. | An admin clicks "Continue with Google" instead of typing a password. | ⬜ No |
| **Magic link / passwordless sign-in** | Sign in with an emailed link or code and no password. Kept only as a fallback. | Admin clicks "email me a sign-in link" and is logged in from the email. | ⬜ No |
| **Multi-factor authentication (2FA)** | A second step (app code, etc.) on top of the password for extra security. | After the password, the admin enters a 6-digit code from an authenticator app. | ⬜ No |
| **Phone / SMS one-time codes** | Verify or sign in by text message. PackPerks uses email, not phone. | A code arrives by SMS instead of email. | ⬜ No |
| **Custom SMTP / branded auth emails** | Send verification and reset emails from our own domain and branding. | The verification email comes from `no-reply@packback.network` with the PackPerks logo. | ⬜ No |
| **Enterprise SSO / SAML** | Large vendor organisations log in through their own company identity system. | A vendor manager signs in via their corporate single sign-on. | ⬜ No |
| **Native account linking / merge** | The provider itself merges two identities. PackPerks already does its own customer account merge, so native support is optional. | An anonymous device account is linked to an email so cups follow the customer to a new phone. | ⬜ No |
| **Auth event webhooks / audit log** | The provider notifies our backend on sign-in or sign-up, or gives a ready-made audit trail. PackPerks keeps its own login history and action log. | A webhook fires whenever a new admin account is created. | ⬜ No |
| **Configurable code length / format** | Choose the shape of the one-time code (for example a clean 6-digit number). | Verification codes are always 6 digits, easy to read and type. | ⬜ No |

---

## Summary in one line

To run PackPerks, an auth provider **must** cover: email + password with email-code verification, password reset, long-lived refreshing sessions, server-side token verification, configurable redirect URLs, anonymous access with per-row data protection, a privileged server key, a roles-friendly user store, sign-up gating, rate limiting, and a browser/server SDK. Everything else (social login, MFA, SMS, SSO, branded emails, native merge, webhooks) is a nice-to-have we can add later.
