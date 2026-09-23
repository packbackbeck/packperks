# Who can reach what — roles × dashboard tabs

Source of truth: `src/admin/lib/access.js` (`LEVELS`, `BUILT_IN_ROLES`, `TABS`,
`TAB_GROUPS`). Regenerate this chart from there when a tab is added.

**The four built-in roles.** Three levels; the manager level ships two roles.

| Role | Level | Organisations | Tabs |
|---|---|---|---|
| Master | master | every one | every tab, edit, plus Master settings |
| Manager | manager | the ones on their account (`org_ids`, or all with `all_orgs`) | every tab, edit — except Master settings, MockupMaster and PackPulse |
| Viewer | manager | the ones on their account | every tab, **view only** — except Master settings |
| Vendor | vendor | the ones on their account | Dashboard, User analytics, Reports & alerts, Help & support, Staff app — view only |

Two rules cut across the table:

- **Money is master-only.** Minting cups and creating payouts are refused for
  anyone below master, whatever their tab access says (`hasPermission()`, and
  the edge functions check it again).
- **The database is not the boundary.** Which tab a role may change, and which
  venues it sees, is enforced by the dashboard. See *Org isolation* in
  CLAUDE.md.

A tab can also be hidden for reasons that have nothing to do with the role:
the venue's programme mode, a feature switched off in Settings, or a master
switching it off for the whole workspace (`workspace:tabs`).
`tabAvailability()` is the one place that decides.

---

## Paste this into FigJam

FigJam turns Mermaid into a diagram: **paste the block below onto the canvas**
(or use the diagram/Mermaid input). Colours are not carried over — select the
role nodes afterwards and colour them there.

```mermaid
flowchart LR
  %% ── The four roles ──────────────────────────────────────────────
  R1["MASTER · PackBack staff"]
  R2["MANAGER · runs their venues"]
  R3["VIEWER · read-only"]
  R4["VENDOR · the venue's own people"]

  R1 --- R1s["Every organisation"]
  R1s --- R1s2["Edit every tab"]
  R1s2 --- R1s3["The only role that mints cups or creates payouts"]

  R2 --- R2s["Only their organisations"]
  R2s --- R2s2["Edit every tab they can see"]
  R2s2 --- R2s3["No Master settings, no link-out tabs"]

  R3 --- R3s["Only their organisations"]
  R3s --- R3s2["Sees every tab, changes nothing"]

  R4 --- R4s["Only their organisations"]
  R4s --- R4s2["Sees five tabs, changes nothing"]

  %% ── Three roles reach every group; only the level differs ───────
  HUB{"the whole sidebar"}
  R1 -->|edit| HUB
  R2 -->|edit| HUB
  R3 -->|view| HUB

  HUB --> GA
  HUB --> GB
  HUB --> GC
  HUB --> GD
  HUB --> GE

  %% Master settings is the one tab outside the hub.
  R1 -->|edit, master only| T_master

  %% A vendor gets named tabs, never a whole group.
  R4 -.->|view| T_overview
  R4 -.->|view| T_behaviour
  R4 -.->|view| T_reports
  R4 -.->|view| T_staffapp
  R4 -.->|view| T_support

  %% ── Analytics ───────────────────────────────────────────────────
  GA["ANALYTICS"]
  GA --> T_overview["Dashboard"]
  T_overview --- A1["Headline numbers for the period"]
  A1 --- A2["Trend chart and what stands out"]
  A2 --- A3["One venue or the whole group"]

  GA --> T_behaviour["User analytics"]
  T_behaviour --- B1["How customers arrive, return, redeem"]
  B1 --- B2["User flow: taps, scrolls, screens"]
  B2 --- B3["Switch app capture on or off"]

  GA --> T_stats["System health"]
  T_stats --- C1["Scan success and failures"]
  C1 --- C2["Payout link health per payout"]
  C2 --- C3["Receipt-check accuracy"]

  GA --> T_reports["Reports & alerts"]
  T_reports --- D1["CSV exports"]
  D1 --- D2["Weekly digest recipients"]
  D2 --- D3["Alert rules and thresholds"]

  %% ── Customers ───────────────────────────────────────────────────
  GB["CUSTOMERS"]
  GB --> T_users["Users"]
  T_users --- E1["Accounts, balances, history"]
  E1 --- E2["Merge duplicate accounts"]
  E2 --- E3["Delete a customer and their login"]

  GB --> T_rewards["Rewards & offers — not Deferred Tikkie"]
  T_rewards --- F1["Create and price rewards"]
  F1 --- F2["Budget caps per reward"]
  F2 --- F3["Smart sorting of the list"]

  GB --> T_appdesign["Design & copy"]
  T_appdesign --- G1["Colours and logos"]
  G1 --- G2["Every text in the customer app"]
  G2 --- G3["Show or hide app sections"]

  GB --> T_emailtemplates["Email templates — Deferred Tikkie only"]
  T_emailtemplates --- H1["Subject and body per email"]
  H1 --- H2["Pause an email"]

  GB --> T_futurevendors["Future vendors — groups only"]
  T_futurevendors --- I1["Venues customers asked for"]
  I1 --- I2["Mark one as coming soon"]

  GB --> T_smartbins["Smart bin locations — Deferred Tikkie only"]
  T_smartbins --- J1["Bins on the customer map"]
  J1 --- J2["Address and opening hours"]

  %% ── Generate ────────────────────────────────────────────────────
  GC["GENERATE"]
  GC --> T_byorequests["Static QR code"]
  T_byorequests --- K1["Counter QR, per location"]
  K1 --- K2["Cups per person per window"]
  K2 --- K3["Review scans over the limit"]

  GC --> T_cupqr["Dynamic QR code"]
  T_cupqr --- L1["Mint single-use cup batches — master only"]
  L1 --- L2["Print or download a batch"]
  L2 --- L3["Revoke, restore, set expiry"]

  GC --> T_receiptgen["Receipt generator — not Deferred Tikkie"]
  T_receiptgen --- M1["Test purchase receipts"]
  M1 --- M2["Always passes the receipt check"]

  GC --> T_staffapp["Staff app"]
  T_staffapp --- N1["Switch the phone app on per venue"]
  N1 --- N2["Add staff, approve access requests"]
  N2 --- N3["Log of every code and who made it"]

  %% ── Circulation ─────────────────────────────────────────────────
  GD["CIRCULATION"]
  GD --> T_cupscans["Cup scans — not Deferred Tikkie"]
  T_cupscans --- O1["Every cup scanned back"]
  O1 --- O2["Scans held for review"]

  GD --> T_claims["Claims — not Deferred Tikkie"]
  T_claims --- P1["Review cashback and refund claims"]
  P1 --- P2["Approve or reject with reasons"]
  P2 --- P3["Create the payout — master only"]

  GD --> T_tikkielog["Tikkie payouts — Deferred Tikkie only"]
  T_tikkielog --- Q1["Every Tikkie link and its amount"]
  Q1 --- Q2["Live link status: open, collected, expired"]
  Q2 --- Q3["Check open links, connect status updates"]

  GD --> T_transactions["Cup shares — needs cup sharing on"]
  T_transactions --- S1["Transfers between customers"]

  GD --> T_donations["Donations — needs donations on"]
  T_donations --- U1["Cups and balances given to charity"]
  U1 --- U2["Transfers made to the charity"]

  GD --> T_backupcups["Backup cups — Deferred Tikkie only"]
  T_backupcups --- V1["Offline fallback codes"]
  V1 --- V2["Alarm page and email alerts"]

  %% ── Workspace ───────────────────────────────────────────────────
  GE["WORKSPACE"]
  GE --> T_settings["Settings"]
  T_settings --- W1["Features on or off"]
  W1 --- W2["Payouts, rates and budget"]
  W2 --- W3["Rules, limits and when money expires"]
  W3 --- W4["Locations and privacy policy"]

  GE --> T_master["Master settings — MASTER ONLY"]
  T_master --- X1["People and roles"]
  X1 --- X2["Organisations, groups, regions"]
  X2 --- X3["Workspace tabs and top bar"]
  X3 --- X4["Delete a venue's records"]
  X4 --- X5["PackPulse connections"]

  GE --> T_support["Help & support"]
  T_support --- Y1["Guides"]
  Y1 --- Y2["Support inbox"]

  GE --> T_history["Version history"]
  T_history --- Z1["Everything ever published"]
  Z1 --- Z2["Audit log of who changed what"]

  GE --> T_mockup["MockupMaster — link out"]
  T_mockup --- AA1["Pitch mockup without a venue"]

  GE --> T_packpulse["PackPulse — link out"]
  T_packpulse --- AB1["The PackPulse dashboard"]

  %% ── The exceptions worth drawing ────────────────────────────────
  R2 -.->|hidden| T_mockup
  R2 -.->|hidden| T_packpulse
  %% ── The exceptions worth drawing ────────────────────────────────
  R2 -.->|hidden| T_mockup
  R2 -.->|hidden| T_packpulse
```

### If the chart is too wide for one FigJam board

Paste the roles half on its own first — everything from `flowchart TD` down to
the vendor's dashed arrows — then paste each group's block beside it. The node
names match, so the two halves read as one map.
