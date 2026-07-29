# Plan: Send PackPerks notifications to a Slack channel

Today the dashboard's **Notification center** (Reports page) emails an admin the moment something happens: a new claim, a new account, a cup scanned, a held BYO request, or a held account-merge. This is a plan for also (or instead) posting those events into a **Slack channel**, so the team sees them without watching an inbox.

Short answer: yes, this is straightforward. The events already flow through one edge function (`notify-event`); we add a Slack destination alongside the existing email. Below are two options, what each needs, and the work involved.

---

## Option A: Incoming Webhook (recommended to start)

The simplest, safest way. Slack gives you one secret URL that posts to one channel.

**How it works**
1. In Slack, create an app and turn on **Incoming Webhooks**, then "Add New Webhook to Workspace" and pick the channel (for example `#packperks-alerts`). Slack gives you a URL like `https://hooks.slack.com/services/T000/B000/xxxx`.
2. We store that URL as a Supabase secret (`SLACK_WEBHOOK_URL`) and/or in the Notification center config.
3. The `notify-event` function, which already builds the who/what/where/when details, also does a `POST` to that URL with a small JSON message whenever Slack is enabled.

**What you need to provide**
- A Slack workspace and permission to install an app in it (a workspace admin, or approval from one).
- The **webhook URL** for the channel you want alerts in.

**What we build**
- Add the webhook URL to Supabase secrets.
- ~20 lines in `notify-event`: format a Slack message (title, the same detail rows, and a link back to the relevant admin page) and POST it.
- A small UI addition on the Notification center: a "Send to Slack" toggle and a field for the channel/webhook, plus a "Send test to Slack" button.

**Limits:** one webhook posts to one fixed channel. Good enough for a single team alerts channel. Messages are one-way (no buttons).

---

## Option B: Slack App with a Bot token (richer)

Use this if you later want alerts in **different channels** (for example per store), nicer formatting, or buttons.

**How it works**
1. Create a Slack app, add the `chat:write` scope, install it to the workspace, and invite the bot to each channel.
2. We store the **bot token** (`SLACK_BOT_TOKEN`) as a secret.
3. `notify-event` calls Slack's `chat.postMessage` API with the channel id and a **Block Kit** message (formatted sections, and an "Open in dashboard" button linking to the right page).

**What you need to provide**
- A Slack app created in your workspace (we can give exact click-by-click steps), with the bot invited to the target channel(s).
- The **bot token** and the **channel id(s)**.

**What we build**
- Store the token; map events (or stores) to channels.
- Slightly more code in `notify-event` to build Block Kit messages.

**Limits/extra:** clickable buttons that *act* inside Slack (for example "Approve claim" without opening the dashboard) need Slack **interactivity** turned on plus a small public endpoint (another edge function) to receive the button click and verify Slack's signature. That is a follow-up, not needed for read-only alerts.

---

## Recommended path

1. Start with **Option A** (incoming webhook) for a single `#packperks-alerts` channel. Low effort, covers the main need.
2. Reuse the existing Notification center on/off + event checkboxes, so Slack respects the same "which events" choices as email.
3. Move to **Option B** only if you need per-store channels, richer formatting, or in-Slack action buttons.

## What is required from you (checklist)

- [ ] A Slack workspace and someone who can install an app / create a webhook.
- [ ] The channel you want alerts in (for example `#packperks-alerts`).
- [ ] For Option A: the **Incoming Webhook URL**.
- [ ] For Option B: the **bot token** + **channel id(s)**.
- [ ] A decision: Slack in addition to email, or instead of it.

## What we do

- [ ] Store the Slack secret in Supabase.
- [ ] Extend `notify-event` to post to Slack when enabled (with a link back to the relevant page, reusing the CTA links we already build for the emails).
- [ ] Add a "Send to Slack" toggle + a "Send test to Slack" button on the Notification center.

**Rough effort:** Option A is about half a day including a test. Option B a bit more. Interactive buttons are a separate, larger piece.
