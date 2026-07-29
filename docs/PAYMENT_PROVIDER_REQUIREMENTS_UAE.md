# Payment Provider Requirements for PackPerks (UAE, a Tikkie alternative)

PackPerks pays customers their cashback. When a customer returns cups and an admin approves their claim, we send them the money. In the Netherlands we do this with **Tikkie**. For the UAE we need a similar service that can send small amounts of money to customers in dirhams (AED).

This document lists what that payment provider must be able to do (**must-have**) and what would be nice to have (**nice-to-have**). It is written in plain language so anyone can use it.

### How to use this document

For each feature, look at the provider you are considering and check whether it can do it. Write **Yes** or **No** in the last column. A provider that misses several must-have rows is not a good fit.

A quick note on words:
- **Payout** means sending money out to a customer (not taking money from them).
- **Cashback** is the small amount a customer earns back for returning cups.

---

## Must-have features

The provider needs all of these for PackPerks to work in the UAE.

| Feature | What it means | Simple example | Where we use it in PackPerks | Yes or No |
|---|---|---|---|---|
| **Send money to a customer (payout)** | The service can push money out to a person, not only collect payments. | A customer earns AED 2 back and the service sends them that AED 2. | Every approved cashback claim. |  |
| **Payout by a shareable link** | It creates a link the customer opens to receive the money, so we never have to ask for or store their bank details. | We send "tap here to get your AED 2"; the customer opens it and picks where the money goes. | The payout link on every claim (today shown as the "Tikkie link"). |  |
| **Works in the UAE, in dirhams (AED)** | It is allowed to operate in the UAE and pays in AED into local bank accounts or wallets. | AED 5.00 lands in a customer's UAE bank or wallet. | All payouts for UAE stores. |  |
| **Allows very small payouts** | It lets us send tiny amounts, because cashback is often only a dirham or two. | Paying out AED 1.50 with no high minimum. | Most cashback amounts are small. |  |
| **Low or no fee per payout** | The cost of each payout is small, otherwise tiny cashback loses money. | Sending AED 2 should not cost close to AED 2 in fees. | Every payout; it affects the whole business. |  |
| **Our system can create payouts by itself (API)** | Our software can start a payout automatically the moment an admin approves, with no manual bank transfer. | An admin taps "Approve and Pay" and the payout is created instantly. | The claim approval step. |  |
| **Tells us the status of each payout** | We can see whether a payout was created, opened, paid, expired, or failed. | The claim moves from "Waiting" to "Paid". | The status column on the Claims page. |  |
| **Expires and returns unclaimed money** | If a customer never opens their link, the money comes back instead of being lost. | The link expires after 14 days and the amount is returned to us. | Unclaimed cashback links. |  |
| **Handles direct refunds (no receipt)** | It can pay a customer directly without a purchase, for example returning a cup deposit. | Refunding a AED 5 cup deposit straight to the customer. | The "direct refund" type of claim. |  |
| **Has a test mode (sandbox)** | It lets us test payouts with pretend money before going live. | Running a AED 2 test payout that moves no real money. | Setup and checking before launch. |  |
| **Gives a record of all payouts** | We can download a history of every payout for accounting. | A monthly list of all cashback we paid. | Finance and the Reports page. |  |
| **A business account we can fund** | We (or the store) can hold a balance that payouts are paid from. | Topping up a balance that customer cashbacks come out of. | The store's payout wallet. |  |

---

## Nice-to-have features

Useful, but PackPerks can still launch without them.

| Feature | What it means | Simple example | Where we use it in PackPerks | Yes or No |
|---|---|---|---|---|
| **Instant payouts** | The money arrives in seconds instead of the next day. | Cashback appears in the customer's account right after approval. | A faster, nicer experience for the customer. |  |
| **Pay many customers at once (bulk)** | It can send lots of payouts in one action. | Paying 200 approved claims in a single batch. | Busy days with many approvals at once. |  |
| **Automatic status updates (webhooks)** | The provider tells our system the instant a status changes, so we do not have to keep checking. | We are notified the second a customer collects their cashback. | Keeping the Claims status fresh without delay. |  |
| **Arabic and right-to-left screens** | The customer's payout page can be shown in Arabic. | A customer sees the collect page in Arabic, not only English. | The customer-facing collect-cashback page. |  |
| **Customer can choose how to receive it** | The customer picks bank, card, or a wallet such as Apple Pay. | One customer takes a bank transfer, another a wallet. | The collect-cashback screen. |  |
| **Pay by QR code** | The customer scans a QR code to receive their money. | Showing a QR at the counter for the customer to collect cashback. | In-store collection. |  |
| **One account for both countries** | The same provider pays euros in the Netherlands and dirhams in the UAE. | A single setup covers NL and UAE. | Running both regions together. |  |
| **Branded (white-label) payout page** | The collect page shows PackPerks or the store's logo and colours. | The link opens looking like our own app. | The customer's collect-cashback link. |  |
| **Payout limits and fraud controls** | We can set caps, for example a maximum per payout or per day. | Blocking any single payout above AED 50. | Safety and preventing mistakes or abuse. |  |
| **Collect money from stores (pay-in)** | It can also charge the store to fund the cashback pool. | Billing a cafe each month for the cashback we paid their customers. | Store billing (today we email a summary for manual charging). |  |
| **Customer support for disputes** | Help is available if a customer says they did not get paid. | A support channel to trace a missing payout. | Handling customer complaints. |  |

---

## In one sentence

To replace Tikkie in the UAE, the provider **must** be able to send small AED payouts to customers by a shareable link, automatically from our system, with status tracking, expiry of unclaimed links, direct refunds, a test mode, and a downloadable record. Everything else (instant payouts, bulk, Arabic, wallets, QR, store billing) is a bonus we can add later.
