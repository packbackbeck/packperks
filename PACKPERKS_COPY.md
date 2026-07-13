# PackPerks: Customer Copy Deck

Every piece of customer-facing copy longer than 3 words, pulled verbatim from the app source.

**Excluded** (per request): CTA / button / link labels, the cashback "fine print" terms, and the privacy & cookie policy document. Strings of 3 words or fewer are omitted. Dynamic values are shown as `{templates}`.

---

## 1 · Home & hero

- **(BYO)** Bring your cup, earn cashback
- **(BYO)** Use your own reusable cup and collect rewards every time you refill.
- **(Deposit)** Collect & Get Rewards
- **(Deposit)** Return your packaging and earn cashback.

---

## 2 · "How it works" walkthrough

**BYO steps**
- Bring your own cup
- Visit a participating café with your reusable cup, no deposit, no single-use packaging.
- Scan the QR at the counter and one cup is added to your balance at that venue.
- Track your progress here and at every other participating store. Each keeps its own balance.
- Once you've collected enough cups, buy your reward and scan the store receipt so we can verify your purchase.
- After your receipt is approved, we send you a Tikkie link to collect your cashback.

**Deposit steps**
- Drop your cup or packaging into the SmartBin at the counter.
- Scan the receipt or QR you get so the cup lands in your balance.
- Every returned cup counts toward real cashback, sent to you via a Tikkie link.

**Built-in default guide (fallback artwork copy)**
- Buy it in the store
- Bring your reusable cup to any participating spot and scan the counter QR. Every cup you collect adds to your balance.
- Collect enough cups to unlock a reward, then choose the product you want from the list.
- Buy that product at any supermarket or grocery store in the Netherlands, and keep the printed receipt.
- Snap a photo of your receipt so we can confirm the purchase.
- Once it is verified, we send you a Tikkie link to collect your cashback, usually within a few days.

---

## 3 · Cookie consent

- A quick cookie choice
- We use **essential** cookies to run PackPerks: to register your account, remember your cup balance, and keep track of your reward claims. With your consent we also use **analytics** to understand how the app is used. No ads, no third-party trackers.
- Choose what PackPerks may use. You can change this any time. Turning everything off means the app can't run.
- Essential: keeps you signed in and remembers your cups and claims. *(Technical toggle)*
- Anonymous usage stats that help us improve the app. *(Analytical toggle)*
- Occasional offers and updates about your rewards. *(Marketing toggle)*
- PackPerks needs essential cookies
- We can't register your account or remember your cups without essential cookies. Any cups you've already collected are safe and stay in your account.

---

## 4 · "Open in your browser" prompt

- Open in Safari to keep your cup
- Open in your browser
- You opened this inside an app's built-in browser, so this cup won't carry over to your normal browser. To keep it, tap the ••• (or share) button and choose "Open in Safari", or collect it here for now.
- You opened this inside an app's built-in browser. Open it in your default browser so your cup is saved to your phone, not lost when this window closes.
- Your cup is safe either way.
- If Safari didn't open, tap the ••• (or share) button and choose "Open in Safari", or collect your cup right here.
- We asked your phone to open this in your default browser. Nothing happened? You can still collect your cup right here.

---

## 5 · Rewards (featured card, list card, detail sheet)

- €{amount} for {n} cups
- Unlock your reward via cashback
- Collect cups to earn cashback. Keep your purchase receipt. You'll need it to claim.
- Scan your receipt and we'll send you a Tikkie link to collect your cashback.
- Once your receipt is approved, we'll send you a Tikkie link to collect your cashback, usually within a few days.
- Collect {n} more cups to unlock your cashback. *(singular: "Collect {n} more cup to unlock your cashback.")*
- Your {reward} cashback is on its way. We'll send you a Tikkie link to collect it once your receipt is approved.
- Nutritional info (per serving)
- Collect {n} cups to unlock this reward by returning your reusable cups at {brand}.
- Buy your {reward} at any supermarket or grocery store in the Netherlands, and keep the printed receipt. Keep it; it can't be added later.
- Upload a photo of your receipt to verify your purchase. We'll send your cashback via a Tikkie link.
- Once verified, we'll send you a Tikkie link to collect your €{amount} cashback, usually within a few days.
- Keep the printed store receipt that lists your item. It is required for cashback, and it is not the same as your cup-return ticket.

---

## 6 · Collecting cups (counter-QR scan)

- Scan your cup QR
- Point your camera at the PackPerks QR on the café counter. We'll add a cup to your balance at that venue.
- Point your camera at the QR code on the counter and hold steady in good light.
- Adding {n} cups to your balance… *(singular: "Adding {n} cup to your balance…")*
- Camera access denied. Scan the counter QR with your phone camera instead.
- That QR isn't a valid PackPerks cup code.
- Your cup has been added to your balance.

**Scan result: cross-store / limit / success (mode-aware)**
- **(BYO)** A new store, a fresh balance
- **(BYO)** You're collecting at a different store in this group. This cup is added here. Each store keeps its own balance, so your cups at other venues stay exactly where they are.
- **(BYO)** You've reached today's cup limit
- **(BYO)** There's a limit on how many cups you can collect per day at this store, and you've hit it for today. We'll review this scan and, if it's valid, add the cup to your balance.
- **(BYO)** Nice one, that's another cup toward your cashback.
- **(Deposit)** A separate balance here
- **(Deposit)** Each store keeps its own cup balance. This cup is added at this store. Your cups at other stores stay where they are.
- **(Deposit)** This one's being checked
- **(Deposit)** You've reached today's automatic limit. This extra cup has been sent for a quick review and will appear once it's approved.
- **(Deposit)** Nice, that's another cup toward your cashback.
- Couldn't add the cup
- Please try scanning the counter code again in a moment.

---

## 7 · Submitting a receipt

- Before you take the photo
- Your receipt must be:
- The printed store receipt from your purchase, not the cup-return ticket
- Clearly listing the {item} you're claiming
- Fully readable, with no blur, glare, or cropped edges
- Dated after your cup return
- Your cup-return ticket (the QR receipt from the bin), that one only adds cups
- A bank app or online-order receipt, or any screenshot
- A photo of the checkout screen at a self-service till
- Take a photo of your store receipt
- We'll review your receipt and send you a Tikkie link to collect your cashback, within 7 days maximum.
- Your photo is checked automatically to verify the purchase (processed by our AI provider in the US, not used to train models) and deleted after review.
- Hold tight, this usually takes a few seconds. *(verifying)*

---

## 8 · Verdict: approved / rejected

**Approved (SuccessPage)**
- We'll review it and send you a Tikkie link to collect your €{amount} cashback, within 7 days.

**Rejected (ReceiptRejectedPage, component's own copy)**
- This was a problem on our side, not with your receipt.
- Give it a moment and try again. If it keeps failing, get in touch and we'll sort it out.
- Your cups are safe. Nothing was spent on this claim.

---

## 9 · Direct refund

- You're leaving money on the table
- Choosing a food reward gives you {n}% more value per cup than a direct cash refund.
- A food reward can give you more value per cup than a direct cash refund.
- You'd miss out on €{amount} by choosing the direct refund
- We'll send you a Tikkie link to collect it 💸
- Tikkie link arrives within 7 days
- We'll review your refund and send a Tikkie link to collect your money. Open it to get paid. Your cup balance has been reset to zero.

---

## 10 · Donate

- You don't have any cups yet
- You need at least 1 cup in your balance before you can donate. Return a reusable cup at any participating {brand} to get started, then come back here to donate.
- Donate to Plastic Soup Foundation
- Your return helps fund campaigns against plastic pollution. We work together to keep the oceans clean.
- This cup did not become waste *(plural: "These {n} cups did not become waste")*
- Your return helps fund Plastic Soup Foundation's campaigns against plastic pollution.

---

## 11 · Share cups

- You don't have any cups yet
- You need at least 1 cup in your balance before you can share or pass it on as "Next cup for free". Return a reusable cup at any participating {brand} first, then come back here.
- A friend scans your QR. They receive your cups, you lose them from your balance.
- {n} cups will be removed from your balance once you tap Share. *(singular: "cup")*
- Show this QR to your friend
- The first person to scan claims your {n} cups. Once scanned, the QR can't be used again. *(singular: "cup")*
- Friend scans with their camera app
- Expires in {h}h {m}m  ·  Expires in {n} minutes  ·  Expired. Ask sender to generate a fresh QR
- {n} cups removed from your balance. New balance: {newBalance}. *(singular: "cup")*
- No user session. Please reload the app.
- You only have {n} cups in your balance. Return more cups before sharing, or lower the amount.
- You don't have enough cups to share {n}. Your current balance is {n}. Return more cups first.
- Could not generate share QR. Please try again.

---

## 12 · Sign in & email

**Screen body copy**
- Save your cups across devices
- Link your balance to an email so you can pick up where you left off, even after switching phones or clearing your browser.
- Add an email to your balance so you can recover it later. No code needed. It's saved right away.
- We use your email to sign you in, restore your cups, and send reward status and important service messages.
- You must be 16 or older to use PackPerks. See our Privacy Policy for how we handle your data.
- Send me PackPerks offers, reward reminders and participating-venue updates by email. Optional. Unsubscribe anytime. *(marketing consent)*
- We sent a 6-digit code to {email}. Enter it below to finish linking your cups.
- On a computer you can also just tap the sign-in link in the email.
- This email already has cups
- {email} is already linked to another account on PackPerks. To use it here, we'll send a 6-digit code to verify it's you, then combine the cups into one account. *(variant: "{n} other accounts")*
- Your balance is linked to {email}. You can update it any time.
- Your cups are backed up to {email}. You can sign in from any device with this email. Your balance and history will be right there.
- Enter a new email for this account. We'll send a confirmation link to it. Your current email {email} stays active until you open it.
- We sent a confirmation link to {email}. Open it to finish switching your email. Until then, {email} stays on your account.
- Enter the email you used before. We'll send a 6-digit code to confirm it's you, then bring your cup balance back to this device.
- We sent a 6-digit code to {email}. Type it below, codes expire after a few minutes.
- Your previous balance has been merged into this device. You now have {n} cups total. *(singular: "cup")*
- Your previous cup balance is now available on this device.
- This device is now backed up to {email}.
- We didn't find an earlier balance under {email}, but you're now signed in. Any cups you collect from now on will be saved to this email.

**Validation / error messages**
- That email doesn't look quite right, try again.
- Could not save your email. Please try again.
- Something went wrong. Please try again.
- That code is 6 digits, check the email and try again.
- That code expired. Tap "Resend" below to get a fresh one.
- That code doesn't match. Double-check the email: 6 digits, no spaces.
- Something went wrong verifying the code.
- That's already your email on this account.
- Could not start the email change. Please try again.
- You're already signed in with this email on this device. Your cups are already here.
- That code expired. Tap "Send a new code" below to get a fresh one.
- That code doesn't match. Double-check the email: codes are 6 digits, no spaces.
- Looks like you're already signed in to this account on this device. Your cups should already be here. Pull to refresh to check.
- Could not send the code. Please try again.

---

## 13 · Account / profile

- Two ways to begin: scan your first cup, or save your email. Either one sets up your account and unlocks cashback.
- Total across all your stores combined.
- Your balance at {store}.
- Your activity is linked to your account.
- No activity yet. Start by scanning a counter QR!
- You can view, export, correct or delete your data at any time. Requests are handled at {email}. Cups you've already earned stay in your account until you delete it.
- Reset this device? Your cups stay safe in your account, but this browser will forget your local data and sign out.
- Delete your account and personal data? This clears your saved email now and requests full erasure. Your cups will be removed. This cannot be undone.

**Impact detail**
- Look what you've done
- Together with everyone using PackPerks
- Couldn't reach the server for community totals.
- Collect your first cup to see your impact
- I've returned {n} cups with PackPerks. That's {weight} of plastic kept out of landfill. *(share text)*
- Reusable cups · real rewards *(share card)*
- Plastic kept out of landfill *(share card)*

**Impact comparison phrases** *(also used on the Stores hub)*
- {n} disposable coffee cups kept out of landfill *(singular: "cup")*
- roughly {n} plastic grocery bags of waste avoided *(singular: "bag")*
- about {n} plastic straws kept out of the ocean *(singular: "straw")*
- {n} disposable plastic forks that didn't get thrown away *(singular: "fork")*
- about the weight of a sugar packet of plastic saved
- about the weight of a chocolate bar of plastic saved
- about the weight of an apple of plastic saved
- about the weight of a paperback book of plastic saved
- about the weight of a bag of sugar of plastic saved
- about the weight of a brick of plastic saved
- about {n} kg of plastic, a small backpack's worth

---

## 14 · Stores hub

- Get cashback for your reusable cup
- **(BYO)** Bring your own cup to any café below and scan the QR to collect cups, then turn them into real cashback. New here? Just pick a store to start.
- **(Deposit)** Return your packaging, scan, and earn cashback. Your cups are saved separately at each participating store.
- No store locations to show yet.
- No stores match "{query}".
- by all PackPerks users together
- {weight} plastic avoided together
- That's {impact comparison}.
- Bring your cup and scan to start saving plastic.

---

## 15 · Activity & pending claims

- Approved by our team. Collect your {amount} cashback through the secure Tikkie link.
- A PackPerks team member checks every receipt by hand. Your Tikkie link to collect this cashback arrives within 7 days.
- Notify me when it's ready:
- Push isn't supported in this browser. Email still works.
- Notifications are blocked for this site. Allow them in your browser settings.
- Push permission wasn't granted. Email still works.
- Ready: collect via Tikkie *(activity live status)*
- In review by our team *(activity live status)*
- If this link no longer opens, it may have expired. Contact us and we'll reissue it.
- Activity copied to clipboard

**Activity-feed labels** *(dynamic history entries)*
- Cup collected at {brand}  ·  {n} cups collected at {brand}
- Donated {n} cup(s) to Plastic Soup Foundation
- Shared {n} cup(s) via QR code
- Direct refund: {n} cup(s), €{amount}

---

## 16 · Cup-QR error screens

- Someone already used this QR
- Every cup QR can only be claimed once. Looks like another customer scanned this receipt first.
- If a friend shared this QR with you, ask them to share again, or scan the counter QR at the venue for a fresh cup.
- These cups were already claimed
- Each cup token can only be added to one customer's balance. The cups on this receipt have already been claimed.
- Check your activity. If this was an earlier scan of yours, the cups are already in your balance.
- This QR isn't valid
- The server doesn't recognise this receipt. It might be misprinted, expired, or not from a participating {brand}.
- Try scanning a different receipt. Make sure it's from a participating restaurant and the QR is fully in frame.
- This receipt has expired
- This QR receipt is past its claim window. Receipts can only be redeemed for a limited time after they're printed.
- Scan the counter QR again on your next visit for a fresh cup.
- This QR has been cancelled
- An admin marked this batch as no longer valid, usually because the receipt was misprinted or reissued.
- Ask {brand} staff for a replacement receipt. Your other cups are unaffected.
- We couldn't read this QR
- Part of the code came through scrambled. This sometimes happens when the QR is partly hidden, smudged, or photographed at an angle.
- Hold the receipt flat, in good light, and try again.
- This QR is empty
- The QR code didn't contain any cup tokens. That shouldn't normally happen. It might be a test QR.
- Ask the staff at {brand} for a fresh receipt with cup tokens.
- That's a lot of cups
- This QR claims more cups than we allow in a single scan. We cap each scan to prevent fraud.
- If this is a legitimate receipt, contact support and we'll process it manually.
- Something went wrong on our end
- We couldn't process this scan right now. It's not your fault. Your balance is safe.
- Wait a moment and try the scan again. If it keeps failing, we want to hear about it.
- We couldn't add these cups
- Try scanning a different QR. If this keeps happening, contact support.
- The QR code is invalid or its cup tokens don't exist anymore.
- We couldn't read that photo. Please retake it or pick a different image.
- We couldn't reach the verification service. Your cups have not been used. Please try again in a moment.
- Couldn't activate this cup QR. It may already have been used.

---

## 17 · System states

**Load / connection error**
- We're having trouble loading your cups
- Something on our end is taking longer than expected. Give it a moment and try again. Your balance is safe.
- We're getting things ready
- PackPerks is being set up for the first time on this device. Please check back in a few minutes.
- PackPerks is taking a quick break
- Our service is temporarily idle. It should be back online shortly. Thanks for your patience.
- Can't reach the PackPerks service
- Looks like a network hiccup. Check your connection and tap retry below.

**Maintenance**
- We'll be back shortly. Thanks for your patience.

**Rewards budget paused**
- Rewards are paused for a moment
- We're handling a high number of reward claims right now, so claiming is briefly unavailable. Please try again a little later.
- Your cups are safe and stay on your balance.
