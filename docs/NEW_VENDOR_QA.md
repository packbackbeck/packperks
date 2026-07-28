# New Vendor — Onboarding Checklist & QA Form

Use this whenever we add a new vendor (a new store/brand) to PackPerks.

- **Part 1** is the setup to-do list — everything to create in the admin dashboard.
- **Part 2** is the QA form — the flows to test afterwards, admin side and user side.

Keep it simple: tick a box when it's done or passes. Note anything odd in the "Issues" box at the end.

Vendor name: ______________________  Slug: `/________/`  Date: __________  Checked by: __________

---

## Part 1 — Setup checklist (admin dashboard)

Most of this is the **"Add organisation"** wizard (9 steps). Open it from the **Organizations** page, top of the dashboard.

- [ ] **1. Brand identity** — organisation name, URL **slug** (e.g. `/bigcoffee/`), partner display name, primary brand colour, logo.
- [ ] **2. Legal & contact** — legal name, KVK/BTW, registered address (fine to fill later).
- [ ] **3. First location** — address of the first venue.
- [ ] **4. Cup economics** — cashback / refund rate per cup, and the max cups per scan.
- [ ] **5. Starter rewards** — at least one reward (name, price €, cups needed, photo).
- [ ] **6. App copy** — the home headline and subtext the customer sees.
- [ ] **7. Feature flags** — turn on/off sharing, donations, direct refunds, activity, impact.
- [ ] **8. Team invites** — invite the vendor's admins by email (optional).
- [ ] **9. Review & launch** — check the summary, then create.

Then finish setup on these tabs:

- [ ] **Settings** → add every other **Location** ("+ Add location") with its address.
- [ ] **Rewards & Offers** → add the rest of the rewards; check each price, cups needed and image.
- [ ] **App Design** → check **Colors**, **Copy** and **Sections**; use the **Live preview** on the right.
- [ ] **Region / payout** — set the org **country** so the currency and payout are right (Netherlands → Tikkie). Wrong country = no payout link.
- [ ] **BYO QR Codes** (bring-your-own-cup vendors) → pick a location, generate the counter QR and **Download** it for the counter. *(Deposit-cup vendors: use **Receipt Generator** instead to print cup QR codes.)*
- [ ] **Reports** (optional) → set the recipient email for the **Weekly digest** and **Notification center**.
- [ ] **Publish** (top-right button) so the store goes live.
- [ ] Open the store link `/<slug>/` in a browser — it should load with the right logo, colours and rewards.

---

## Part 2 — QA form

Test on a real phone if you can. Do the **user side first** (it creates the data the admin side reviews).

### A. User / customer side (open `/<slug>/`)

- [ ] **Store loads** with the correct logo, brand colour, name and headline.
- [ ] **Rewards show** correctly (right name, price, cups needed, image).
- [ ] **Add a cup** — tap **+ / Add more cups**, scan the counter QR → a cup is added and the success popup shows.
- [ ] **Cup progress goes up** on the home screen by the right amount.
- [ ] **Claim a reward** — with enough cups, tap **Get cashback** → the receipt rules screen shows → take/upload a receipt photo.
- [ ] **Confirmation** — you land on the "request sent / reward claimed" screen. If you added an email, a "we got your cashback request" email arrives.
- [ ] **Account page** — tap the person icon: balance is correct, and the claim shows under **Your cashback claims** as **In review**.
- [ ] **Save email & restore** — save your email, then open the store in another browser, sign in with that email → your cups come back.
- [ ] **Help block** — **Contact support** opens the form, **How does it work?** opens the guide, **FAQ** opens the popup.

*(Come back after the admin steps below:)*
- [ ] **Approved claim** — after the admin approves, the claim shows **Ready to collect** with a payout link, and the approval email arrives.
- [ ] **Rejected claim** — after the admin rejects, the claim shows **Not approved** with the failed-rule chips and an **Upload a different receipt** button.

### B. Admin side (dashboard, switched to the new vendor)

- [ ] **Right vendor** — the org switcher shows the new vendor; the dashboard data is scoped to it.
- [ ] **Users** — the customer who just scanned/claimed appears.
- [ ] **Cup Scans** — the scan appears, with the correct location.
- [ ] **Claims** — the submitted claim appears. Click the row → the review panel opens with the receipt photo.
- [ ] **Reject flow** — mark the receipt criteria Yes/No, add a reason, **Reject**; the customer sees the reasons (test on the user side above).
- [ ] **Approve flow** — on another claim, tick the criteria and **Approve & Pay**; a payout link is created (Netherlands → Tikkie).
- [ ] **Overview** — cups, users and the location share look right for the new vendor.
- [ ] **Reports** — send a **test** weekly digest and a **test** notification; both emails arrive with the vendor's details.

---

## Sign-off

- [ ] All boxes above are ticked (or the exceptions are noted below).

**Issues found:**

_____________________________________________________________________

_____________________________________________________________________

Signed: ______________________  Date: __________
