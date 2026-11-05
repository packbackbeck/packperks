/* Dutch and English copy for the demos. Brand names, product names and
 * the app's own English labels ("Order Now", "News") stay as they are.
 * A brand can override any key (brands.js → strings). */

export const STRINGS = {
  nl: {
    // ── the Packback parts ──
    unit: 'punten', unitOne: 'punt', unitShort: 'pnt',
    ppHead: 'Beker terug, punten erbij',
    perCup: '1 beker = {n}',
    toGo: 'Nog {n} tot',
    allIn: 'Alle beloningen binnen bereik',
    redeem: 'Inwisselen', almost: 'Bijna!',
    worth: 'Waarde {v}', leftAfter: 'Daarna nog {n} over',
    needMore: 'Nog {n} nodig. Lever je bekers in!',
    earnedTitle: 'Beker ingeleverd', earnedBody: '+{n} op je saldo',
    returnCup: 'Beker inleveren', scanBin: 'Scan de QR-code op de Packback-bin.', simulate: 'Scan simuleren',
    thanks: 'Beker ingeleverd, dankjewel!', unlocked: '{name} is nu gratis!',
    another: 'Nog een', rewards: 'Beloningen', yourBalance: 'Jouw saldo',
    step1: 'Beker inleveren', step2: 'QR scannen', step3: 'Inwisselen aan de kassa',
    cupsReturned: '{n} bekers ingeleverd', cupReturnedOne: '1 beker ingeleverd',
    activity: 'Activiteit', justNow: 'Zojuist', minutesAgo: '{n} min geleden', cupBack: 'Beker ingeleverd',
    close: 'Sluiten', cancel: 'Annuleren', done: 'Klaar',
    showStaff: 'Laat dit zien aan de medewerker',
    staffNote: 'Schuiven haalt <strong>{n}</strong> van dit saldo.',
    slide: 'Schuif om in te wisselen', redeeming: 'Inwisselen…',
    redeemed: 'Ingewisseld', enjoy: 'Eet smakelijk!',
    notInDemo: 'Dit zit niet in de demo',

    // ── the demo page ──
    demo: 'Demo', demoBalance: 'Saldo', demoRefresh: 'Ververs = +1 beker (+{n})',
    demoEarn: '+ Beker inleveren', demoReset: 'Opnieuw', demoLanguage: 'Taal',
    demoNote: 'Alleen in deze browser', demoLive: 'live beloningen',
    demoPickTitle: 'Packback in jouw app', demoOpen: 'Open demo',

    // ── KFC ──
    kfcWelcome: 'Welkom! Ontdek al onze exclusieve app deals of<br>plaats snel je bestelling.',
    kfcDealsIntro: 'Exclusieve app deals, alleen voor jou. Activeer een deal en laat de code scannen.',
    kfcWithPoints: 'Inwisselen met punten',
    kfcWeekDeal: 'Deal van de week', kfcDaysLeft: 'Nog 3 dagen',
    kfcFeatDesc: 'Krokante kip, Doritos, jalapeños en saus. Nu met €1 korting in de app.',
    kfcFeatPrice: '€4,99<s>€5,99</s>',
    kfcAllDeals: 'Alle deals', kfcActivate: 'Activeer', kfcActivateDeal: 'Activeer deal',
    kfcFine: 'Deals zijn geldig in deelnemende KFC restaurants in Nederland. Eén deal per bestelling. <u>Voorwaarden</u>',
    kfcChips: { all: 'Alle deals', pp: 'Punten', kip: 'Kip', menus: 'Menu’s', snacks: 'Snacks' },

    // ── McDonald's ──
    mcdHello: 'Goedenavond, Beke', mcdCode: 'Mijn code',
    ppHeadMcd: 'Breng je beker terug: +10 punten',
    mcdNews: 'Nieuws', mcdFryday: 'It’s fry-day!', mcdFrydaySub: 'Speel de game en ontgrendel deals.',
    mcdDeals: 'Deals', mcdSeeAll: 'Bekijk alles',
    mcdDeal1: '6 Chicken McNuggets® 50% korting', mcdDeal2: 'McChicken® Menu deal', mcdDeal3: 'Gratis McFlurry® bij een menu',
    mcdTabs: { home: 'Home', deals: 'Deals', order: 'Bestel', rewards: 'Rewards', more: 'Meer' },
    mcdRewardsSub: 'Spaar met elke bestelling én met elke beker die je terugbrengt.',
    mcdSwap: 'Wissel je punten in',
    mcdMore: 'Meer', mcdAccount: 'Mijn account', mcdRestaurants: 'Restaurants', mcdPrefs: 'Voorkeuren',
    mcdHelp: 'Help & contact', mcdLegal: 'Juridisch', mcdLogout: 'Uitloggen',
    mcdPointsRow: 'Bekers inleveren',
  },

  en: {
    unit: 'points', unitOne: 'point', unitShort: 'pts',
    ppHead: 'Bring cup back, get points',
    perCup: '1 cup = {n}',
    toGo: '{n} to go for',
    allIn: 'Every reward is within reach',
    redeem: 'Redeem', almost: 'Almost!',
    worth: 'Worth {v}', leftAfter: '{n} left after',
    needMore: '{n} more needed. Return your cups!',
    earnedTitle: 'Cup returned', earnedBody: '+{n} on your balance',
    returnCup: 'Return a cup', scanBin: 'Scan the QR code on the Packback bin.', simulate: 'Simulate scan',
    thanks: 'Cup returned, thank you!', unlocked: '{name} is now free!',
    another: 'Another one', rewards: 'Rewards', yourBalance: 'Your balance',
    step1: 'Return cup', step2: 'Scan QR', step3: 'Redeem at the counter',
    cupsReturned: '{n} cups returned', cupReturnedOne: '1 cup returned',
    activity: 'Activity', justNow: 'Just now', minutesAgo: '{n} min ago', cupBack: 'Cup returned',
    close: 'Close', cancel: 'Cancel', done: 'Done',
    showStaff: 'Show this to the staff at the counter',
    staffNote: 'Sliding takes <strong>{n}</strong> from this balance.',
    slide: 'Slide to redeem', redeeming: 'Redeeming…',
    redeemed: 'Redeemed', enjoy: 'Enjoy your meal!',
    notInDemo: 'Not part of this demo',

    demo: 'Demo', demoBalance: 'Balance', demoRefresh: 'Refresh = +1 cup (+{n})',
    demoEarn: '+ Return a cup', demoReset: 'Start over', demoLanguage: 'Language',
    demoNote: 'Only in this browser', demoLive: 'live rewards',
    demoPickTitle: 'Packback in your app', demoOpen: 'Open demo',

    kfcWelcome: 'Welcome! Discover all our exclusive app deals or<br>place your order in no time.',
    kfcDealsIntro: 'Exclusive app deals, just for you. Activate a deal and have the code scanned.',
    kfcWithPoints: 'Redeem with points',
    kfcWeekDeal: 'Deal of the week', kfcDaysLeft: '3 days left',
    kfcFeatDesc: 'Crispy chicken, Doritos, jalapeños and sauce. Now €1 off in the app.',
    kfcFeatPrice: '€4.99<s>€5.99</s>',
    kfcAllDeals: 'All deals', kfcActivate: 'Activate', kfcActivateDeal: 'Activate deal',
    kfcFine: 'Deals are valid at participating KFC restaurants in the Netherlands. One deal per order. <u>Terms</u>',
    kfcChips: { all: 'All deals', pp: 'Points', kip: 'Chicken', menus: 'Meals', snacks: 'Snacks' },

    mcdHello: 'Good evening, Beke', mcdCode: 'My code',
    ppHeadMcd: 'Bring your cup back: +10 points',
    mcdNews: 'News', mcdFryday: 'It’s fry-day!', mcdFrydaySub: 'Play the game to unlock deals.',
    mcdDeals: 'Deals', mcdSeeAll: 'See all',
    mcdDeal1: '6pc Chicken McNuggets® 50% off', mcdDeal2: 'McChicken® Meal deal', mcdDeal3: 'Free McFlurry® with a meal',
    mcdTabs: { home: 'Home', deals: 'Deals', order: 'Order', rewards: 'Rewards', more: 'More' },
    mcdRewardsSub: 'Earn with every order and with every cup you bring back.',
    mcdSwap: 'Redeem your points',
    mcdMore: 'More', mcdAccount: 'My account', mcdRestaurants: 'Restaurants', mcdPrefs: 'Preferences',
    mcdHelp: 'Help & contact', mcdLegal: 'Legal', mcdLogout: 'Log out',
    mcdPointsRow: 'Return cups',
  },
};

/** t('key', { n: 3 }) in the chosen language, with a brand's overrides. */
export function makeT(lang, overrides = null) {
  const table = { ...STRINGS.nl, ...(STRINGS[lang] || {}), ...(overrides?.[lang] || {}) };
  return (key, vars = {}) => {
    const v = table[key] ?? key;
    if (typeof v !== 'string') return v;
    return v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  };
}

export const euro = (lang, v) => {
  const n = Number(v) || 0;
  return lang === 'nl' ? `€${n.toFixed(2).replace('.', ',')}` : `€${n.toFixed(2)}`;
};
