# 🏪 Multi-Store Groups

> **In one line:** PackPerks now works across *many* venues, not just one. Independent stores can be bundled into a single branded **group**, and a customer collects cashback across every venue in that group with **one identity** — while each venue keeps **its own cup balance**.

---

## ⚡ TL;DR

> - A **group** = a set of participating venues under one banner (e.g. *“BYO Netherlands”*).
> - Customers get a **Stores hub** — one page showing every venue in the group, their cups at each, rewards, a live map, and their plastic-avoided impact.
> - **Balances stay per-venue.** Cups earned at one café don’t leak into another — but the person’s **profile (name, email, IBAN) is shared once** across the group.
> - New **“Bring Your Own cup” (BYO)** model: no deposit, no return machine — just scan the counter QR to collect. The original deposit model still works for standalone stores.
> - Admins/partners get a full back office: create groups, add venues, brand the group, see combined stats, and approve fair-use cup requests.

---

## 🎯 Why we need it

PackPerks began as a **single-store** program (one Burger King, one balance, one flow). That’s great for a pilot, but a real reusable-cup network looks nothing like it:

| The reality | What single-store couldn’t do |
|---|---|
| A person visits **several cafés** in a city with their own cup | Every venue was an island — a separate app, separate profile, re-typing their IBAN each time |
| Small venues **don’t have a deposit machine / SmartBin** | The whole flow assumed a deposit + return hardware |
| A brand or city wants to run **one program across many locations** | No way to bundle venues, brand them together, or report on them as a whole |
| Partners want to **manage their own venues and see their numbers** | No group-level admin, no combined stats |

**Multi-Store Groups solves all four.** It turns PackPerks from a one-store loyalty app into a **multi-venue platform** — the foundation for rolling out “bring your own cup → earn cashback” across real networks (today: **the Netherlands** and **the UAE**).

---

## 🧩 What a “group” is

A **group** bundles independent venues (“stores” / “orgs”) under one shared experience.

```
                    ┌─────────────────────────┐
                    │      Group: BYO NL      │   ← shared branding, copy & guide
                    └────────────┬────────────┘
             ┌───────────────────┼───────────────────┐
             ▼                   ▼                    ▼
        La Place          The Chocolate Co.        (more venues…)
      own cup balance      own cup balance
      own rewards          own rewards
             └───────────────────┴───────────────────┘
                          ▲
                          │  ONE shared customer identity
                          │  (name · email · IBAN, entered once)
```

- **Each venue keeps its own balance, rewards, prices and logo.**
- **The group** owns the shared wrapper: branding, the “how it works” guide, terms, and the customer’s single profile.
- A venue can also live **outside** any group (a standalone store), and behaves exactly as before.

---

## ✅ What’s possible now

### 👤 For customers

- **One profile, every venue.** Enter your name, email and IBAN **once** — it’s recognised at every store in the group. No re-registering.
- **A Stores hub.** Open the group link and see **all venues at a glance**: your cups at each, their featured reward, and a **real interactive map** (list ↔ map toggle) to find them.
- **Collect anywhere, balances stay clean.** Cups you earn at one venue stay with that venue — the app clearly explains this the first time you collect at a new store, so there are no surprises.
- **Bring your own cup → scan → collect.** At BYO venues there’s **no deposit and no machine**: spot the counter QR, scan, and a cup is added to your balance.
- **Cashback, per venue.** Collect enough cups at a store, buy your reward, scan the receipt, and cashback lands in your bank account. (No IBAN? You can donate your cups instead.)
- **Your impact, combined.** The hub shows the plastic you’ve avoided — yours and the whole PackPerks community’s.
- **Illustrated guide.** A short, Stories-style “how it works” walkthrough tailored to the group’s model (BYO vs deposit).

### 🧑‍💼 For partners & admins

- **Create & manage groups** from the admin org settings: name it, pick its **model** (Bring-Your-Own-cup or deposit), and add or remove member venues.
- **Turn venues on/off** in a group without deleting them (e.g. a seasonal pop-up).
- **Brand the whole group** — edit the shared **hero text, how-it-works steps, terms, messages and button labels** in one place; individual venues fall back to the group defaults, and the group falls back to sensible system defaults.
- **Combined group analytics.** See the group as a whole *and* per venue — stores, customers, cups, lifetime cups, claims and paid-out cashback — plus a **scope toggle** on the dashboards to flip any report between “this venue” and “the whole group”.
- **Fair-use, human-in-the-loop.** BYO auto-credits up to **2 cups per venue per 24h**; anything beyond that isn’t silently dropped — it becomes a **pending request** the admin can approve or deny from a review queue.
- **Stationary QR generator.** Print a counter “name-tent” QR per venue that customers scan to collect — built right into the admin.

---

## 🔄 How it works (customer journey)

1. **Discover** — the customer lands on the group’s Stores hub (or a specific venue) via a link or the counter QR.
2. **Bring their cup** — at a BYO venue, they order in their own reusable cup.
3. **Scan** — they scan the counter QR; **+1 cup** is added to *that venue’s* balance.
4. **Collect across venues** — they build balances at each store they visit; the hub tracks them all.
5. **Redeem** — once a venue’s cup goal is met, they buy the reward, scan the store receipt, and…
6. **Get cashback** — after the receipt is verified, cashback is paid to their IBAN.

---

## 📖 Key concepts

| Term | What it means |
|---|---|
| **Group** | A set of venues sharing branding, copy and one customer identity. Has its own link (e.g. `/byo-netherlands`). |
| **Venue / Store** | A single participating location. Keeps its own balance, rewards and logo. Can belong to one group, or none. |
| **Model** | How cups are collected: **BYO** (scan the counter QR, no deposit) or **Deposit** (return a cup / SmartBin). Set per group. |
| **Per-venue balance** | Cups are counted per store. Collecting at one venue never changes another’s balance. |
| **Shared identity** | One profile (name, email, IBAN) per person, recognised across every venue in the group. Stored once. |
| **Stores hub** | The multi-venue page: all venues, per-venue cups, featured rewards, map, and impact. Unlocks once the customer has ≥1 cup anywhere in the group. |
| **Fair-use cap** | Up to 2 auto-credited cups per venue per 24h; extra scans go to an admin approval queue. |
| **Group copy** | The editable text for a group (hero, guide, terms, messages, buttons), with venue → group → system fallback. |

---

## 🌍 Live today

Two real groups are set up as the first rollouts:

- **BYO Netherlands** — e.g. *La Place* and *The Chocolate Company*.
- **BYO UAE** — for the Dubai launch.

Standalone stores (the original Burger King-style venues) are untouched and keep working exactly as before — grouping is **opt-in per venue**.
