// Curated "coming soon" venues shown as locked placeholder stores on the
// Stores map/list so a new group's map doesn't look empty. Not participating
// yet — display only. Keyed by REGION (matches the region registry keys in
// regions.js: 'NL', 'AE', …). Coordinates are venue-level.
export const NOT_YET_STORES = {
  NL: [
    // ---- Amsterdam ----
    { name: 'CT Coffee & Coconuts', area: 'De Pijp, Amsterdam', lat: 52.3536, lng: 4.8914 },
    { name: 'Scandinavian Embassy', area: 'De Pijp, Amsterdam', lat: 52.3548, lng: 4.8918 },
    { name: 'Bakers & Roasters', area: 'De Pijp, Amsterdam', lat: 52.3556, lng: 4.8930 },
    { name: 'Little Collins', area: 'De Pijp, Amsterdam', lat: 52.3563, lng: 4.8955 },
    { name: 'Screaming Beans', area: 'De Pijp, Amsterdam', lat: 52.3541, lng: 4.8901 },
    { name: 'Nook', area: 'De Pijp, Amsterdam', lat: 52.3529, lng: 4.8942 },
    { name: 'TOKI', area: 'Jordaan, Amsterdam', lat: 52.3796, lng: 4.8846 },
    { name: 'Saint Jean', area: 'Jordaan, Amsterdam', lat: 52.3742, lng: 4.8819 },
    { name: 'Back to Black', area: 'Jordaan, Amsterdam', lat: 52.3711, lng: 4.8828 },
    { name: 'Vinnies Deli', area: 'Jordaan, Amsterdam', lat: 52.3781, lng: 4.8901 },
    { name: 'Lot Sixty One Coffee', area: 'Oud-West, Amsterdam', lat: 52.3648, lng: 4.8703 },
    { name: 'White Label Coffee', area: 'Oud-West, Amsterdam', lat: 52.3719, lng: 4.8621 },
    { name: 'Koffie Academie', area: 'Oud-West, Amsterdam', lat: 52.3608, lng: 4.8664 },
    { name: 'The Coffee Virus', area: 'Amsterdam-Oost, Amsterdam', lat: 52.3506, lng: 4.9503 },
    { name: 'Bocca Coffee', area: 'Centrum, Amsterdam', lat: 52.3672, lng: 4.8907 },
    { name: 'Coffee Bru', area: 'Amsterdam-Oost, Amsterdam', lat: 52.3608, lng: 4.9296 },
    { name: 'Monks Coffee Roasters', area: 'Oud-West, Amsterdam', lat: 52.3661, lng: 4.8746 },
    { name: 'Hutspot', area: 'De Pijp, Amsterdam', lat: 52.3547, lng: 4.8909 },
    // ---- Rotterdam ----
    { name: 'Man Met Bril Koffie', area: 'Kralingen, Rotterdam', lat: 51.9270, lng: 4.5090 },
    { name: 'Giraffe Coffee Bar', area: 'Cool, Rotterdam', lat: 51.9165, lng: 4.4777 },
    { name: 'Hopper Coffee', area: 'Kop van Zuid, Rotterdam', lat: 51.9046, lng: 4.4901 },
    { name: 'Urban Espresso Bar', area: 'Centrum, Rotterdam', lat: 51.9201, lng: 4.4789 },
    // ---- Utrecht ----
    { name: 'The Village Coffee', area: 'Binnenstad, Utrecht', lat: 52.0930, lng: 5.1189 },
    { name: 'Koffie Leute', area: 'Binnenstad, Utrecht', lat: 52.0915, lng: 5.1215 },
    // ---- Den Haag ----
    { name: 'Lola Bikes and Coffee', area: 'Hofkwartier, Den Haag', lat: 52.0812, lng: 4.3086 },
    { name: 'Single Estate Coffee', area: 'Centrum, Den Haag', lat: 52.0785, lng: 4.3121 },
  ],
  AE: [
    // ---- Dubai ----
    { id: 'ae-brix-caf-jumeirah-fishing-harbour', name: 'BRIX Café', area: 'Jumeirah Fishing Harbour, Dubai', lat: 25.20995, lng: 55.24409, color: '#5A3A2E', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://brixdessert.com' },
    { id: 'ae-21grams-meyan-mall', name: '21grams', area: 'Meyan Mall, Umm Suqeim 2, Dubai', lat: 25.14468, lng: 55.19872, color: '#C96A45', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://21grams.me' },
    { id: 'ae-the-espresso-lab-dubai-design-district', name: 'The Espresso Lab', area: 'Dubai Design District, Dubai', lat: 25.18891, lng: 55.29814, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://theespressolab.com' },
    { id: 'ae-nightjar-coffee-roasters-alserkal-avenue', name: 'Nightjar Coffee Roasters', area: 'Alserkal Avenue, Al Quoz, Dubai', lat: 25.14273, lng: 55.22488, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://nightjar.coffee' },
    { id: 'ae-raw-coffee-company-al-quoz', name: 'RAW Coffee Company', area: 'Al Quoz, Dubai', lat: 25.15084, lng: 55.22718, color: '#D94A2B', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://rawcoffeecompany.com' },
    { id: 'ae-seven-fortunes-coffee-roasters-al-quoz-industrial-area-2', name: 'Seven Fortunes Coffee Roasters', area: 'Al Quoz Industrial Area 2, Dubai', lat: 25.14034, lng: 55.24009, color: '#D99A2B', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://sevenfortunes.com' },
    { id: 'ae-tom-serg-al-quoz', name: 'Tom & Serg', area: 'Al Quoz, Dubai', lat: 25.14597, lng: 55.2233, color: '#F2A900', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://tomandserg.com' },
    { id: 'ae-boston-lane-the-courtyard', name: 'Boston Lane', area: 'The Courtyard, Al Quoz, Dubai', lat: 25.14326, lng: 55.22264, color: '#D88A9A', logo_url: 'https://ui-avatars.com/api/?name=Boston%20Lane&background=D88A9A&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-cassette-the-courtyard', name: 'Cassette', area: 'The Courtyard, Al Quoz, Dubai', lat: 25.14326, lng: 55.22264, color: '#2B6CB0', logo_url: 'https://ui-avatars.com/api/?name=Cassette&background=2B6CB0&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-nette-matcha-club', name: 'NETTE', area: 'Matcha Club, Al Quoz, Dubai', lat: 25.1399, lng: 55.2224, color: '#6F8F72', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://nette.ae' },
    { id: 'ae-stomping-grounds-jumeirah-1', name: 'Stomping Grounds', area: 'Jumeirah 1, Dubai', lat: 25.22311, lng: 55.25816, color: '#244B3A', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://stompinggrounds.ae' },
    { id: 'ae-common-grounds-mall-of-the-emirates', name: 'Common Grounds', area: 'Mall of the Emirates, Dubai', lat: 25.11811, lng: 55.20061, color: '#F36F21', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://eatx.com' },
    { id: 'ae-friends-avenue-caf-jumeirah-lakes-towers', name: 'Friends Avenue Café', area: 'Jumeirah Lakes Towers, Dubai', lat: 25.07906, lng: 55.14927, color: '#4EA7A2', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://friendsavenue.ae' },
    { id: 'ae-arrows-sparrows-the-greens', name: 'Arrows & Sparrows', area: 'The Greens, Dubai', lat: 25.09658, lng: 55.16857, color: '#F4C542', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://arrowsparrows.com' },
    { id: 'ae-boon-coffee-roasters-one-lake-plaza', name: 'Boon Coffee Roasters', area: 'One Lake Plaza, JLT, Dubai', lat: 25.07967, lng: 55.15013, color: '#6B3E2E', logo_url: 'https://ui-avatars.com/api/?name=Boon%20Coffee%20Roasters&background=6B3E2E&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-arabica-city-walk', name: '% Arabica', area: 'City Walk, Dubai', lat: 25.20391, lng: 55.2629, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://arabica.com' },
    { id: 'ae-maisan15-maisan-towers', name: 'Maisan15', area: 'Maisan Towers, Al Barsha South, Dubai', lat: 25.09128, lng: 55.23037, color: '#8B2F3C', logo_url: 'https://ui-avatars.com/api/?name=Maisan15&background=8B2F3C&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-one-life-kitchen-and-caf-building-5', name: 'One Life Kitchen and Café', area: 'Building 5, Dubai Design District, Dubai', lat: 25.18822, lng: 55.29807, color: '#E05A2A', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://onelifedxb.com' },
    // ---- Abu Dhabi ----
    { id: 'ae-rain-cafe-al-nahyan', name: 'Rain Cafe', area: 'Al Nahyan, Abu Dhabi', lat: 24.47288, lng: 54.38344, color: '#6BA7C7', logo_url: 'https://ui-avatars.com/api/?name=Rain%20Cafe&background=6BA7C7&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-blacksmith-coffee-company-nyu-abu-dhabi', name: 'Blacksmith Coffee Company', area: 'NYU Abu Dhabi, Saadiyat Island', lat: 24.52382, lng: 54.43327, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://blacksmith.ae' },
    { id: 'ae-joud-coffee-al-bateen', name: 'Joud Coffee', area: 'Al Bateen, Abu Dhabi', lat: 24.45728, lng: 54.35487, color: '#8A5A44', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://joudcoffee.com' },
    { id: 'ae-local-mamsha-al-saadiyat', name: 'LOCAL', area: 'Mamsha Al Saadiyat, Abu Dhabi', lat: 24.5405, lng: 54.4303, color: '#222222', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://localco.ae' },
    { id: 'ae-drvn-coffee-hudayriyat-island', name: 'DRVN Coffee', area: 'Hudayriyat Island, Abu Dhabi', lat: 24.41317, lng: 54.34898, color: '#C91F37', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://drvncoffee.com' },
    { id: 'ae-cafe-arabia-al-mushrif', name: 'Cafe Arabia', area: 'Al Mushrif, Abu Dhabi', lat: 24.45833, lng: 54.38417, color: '#D4A72C', logo_url: 'https://ui-avatars.com/api/?name=Cafe%20Arabia&background=D4A72C&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-art-house-cafe-al-bateen', name: 'Art House Cafe', area: 'Al Bateen, Abu Dhabi', lat: 24.44595, lng: 54.35271, color: '#3E6D8E', logo_url: 'https://ui-avatars.com/api/?name=Art%20House%20Cafe&background=3E6D8E&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-third-place-cafe-khalidiya', name: 'Third Place Cafe', area: 'Khalidiya, Abu Dhabi', lat: 24.47312, lng: 54.35284, color: '#4C8A8A', logo_url: 'https://ui-avatars.com/api/?name=Third%20Place%20Cafe&background=4C8A8A&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-the-espresso-lab-qasr-al-hosn', name: 'The Espresso Lab', area: 'Qasr Al Hosn, Abu Dhabi', lat: 24.48235, lng: 54.3542, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://theespressolab.com' },
    { id: 'ae-tashas-al-bateen', name: 'tashas', area: 'Al Bateen, Abu Dhabi', lat: 24.44696, lng: 54.3549, color: '#D2A59A', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://tashasgroup.com' },
    // ---- Sharjah ----
    { id: 'ae-ratios-coffee-souq-al-shanasiyah', name: 'Ratios Coffee', area: 'Souq Al Shanasiyah, Heart of Sharjah', lat: 25.35986, lng: 55.38368, color: '#111111', logo_url: 'https://ui-avatars.com/api/?name=Ratios%20Coffee&background=111111&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-paper-fig-muweilah-commercial', name: 'Paper Fig', area: 'Muweilah Commercial, Sharjah', lat: 25.31703, lng: 55.45845, color: '#C98B98', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://paperfig.ae' },
    { id: 'ae-fen-caf-restaurant-al-mureijah-square', name: 'Fen Café & Restaurant', area: 'Al Mureijah Square, Heart of Sharjah', lat: 25.35734, lng: 55.38269, color: '#385E4D', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://sharjahart.org' },
    { id: 'ae-hoof-caf-east-boulevard', name: 'Hoof Café', area: 'East Boulevard, Aljada, Sharjah', lat: 25.3039, lng: 55.4779, color: '#5A4B8A', logo_url: 'https://ui-avatars.com/api/?name=Hoof%20Caf%C3%A9&background=5A4B8A&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-black-salt-aljada', name: 'Black Salt', area: 'Aljada, Sharjah', lat: 25.3083, lng: 55.4789, color: '#222222', logo_url: 'https://ui-avatars.com/api/?name=Black%20Salt&background=222222&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-caya-aljada', name: 'Caya', area: 'Aljada, Sharjah', lat: 25.3077, lng: 55.4796, color: '#C76D4A', logo_url: 'https://ui-avatars.com/api/?name=Caya&background=C76D4A&color=FFFFFF&size=512&bold=true&format=png' },
    // ---- Al Ain ----
    { id: 'ae-saddle-cafe-al-ain-square', name: 'Saddle Cafe', area: 'Al Ain Square, Al Ain', lat: 24.18956, lng: 55.74417, color: '#E86A2A', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://saddle.cafe' },
    { id: 'ae-rain-cafe-asharej', name: 'Rain Cafe', area: 'Asharej, Al Ain', lat: 24.20233, lng: 55.73205, color: '#6BA7C7', logo_url: 'https://ui-avatars.com/api/?name=Rain%20Cafe&background=6BA7C7&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-the-coffee-club-al-ain-mall', name: 'The Coffee Club', area: 'Al Ain Mall, Al Ain', lat: 24.2169, lng: 55.7612, color: '#7A1F2B', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://coffeeclub.com.au' },
    { id: 'ae-arabica-hili-mall', name: '% Arabica', area: 'Hili Mall, Al Ain', lat: 24.27378, lng: 55.7789, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://arabica.com' },
    // ---- Ras Al Khaimah ----
    { id: 'ae-rain-cafe-grove-village', name: 'Rain Cafe', area: 'Grove Village, Ras Al Khaimah', lat: 25.7036, lng: 55.7812, color: '#6BA7C7', logo_url: 'https://ui-avatars.com/api/?name=Rain%20Cafe&background=6BA7C7&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-the-riser-s-house-al-hamra-golf-club', name: 'The Riser\'s House', area: 'Al Hamra Golf Club, Ras Al Khaimah', lat: 25.6896, lng: 55.7764, color: '#3A6E8C', logo_url: 'https://ui-avatars.com/api/?name=The%20Riser%27s%20House&background=3A6E8C&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-arabica-manar-mall', name: '% Arabica', area: 'Manar Mall, Ras Al Khaimah', lat: 25.78492, lng: 55.96543, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://arabica.com' },
    { id: 'ae-arabica-al-hamra-mall', name: '% Arabica', area: 'Al Hamra Mall, Ras Al Khaimah', lat: 25.683, lng: 55.782, color: '#111111', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://arabica.com' },
    // ---- Ajman ----
    { id: 'ae-the-grove-restaurant-cafe-al-zorah', name: 'The Grove Restaurant & Cafe', area: 'Al Zorah, Ajman', lat: 25.4059, lng: 55.4774, color: '#3B6B4A', logo_url: 'https://ui-avatars.com/api/?name=The%20Grove%20Restaurant%20%26%20Cafe&background=3B6B4A&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-filibuster-cafe-al-rawda-1', name: 'Filibuster Cafe', area: 'Al Rawda 1, Ajman', lat: 25.3865, lng: 55.4596, color: '#273B5A', logo_url: 'https://ui-avatars.com/api/?name=Filibuster%20Cafe&background=273B5A&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-starbucks-city-centre-ajman', name: 'Starbucks', area: 'City Centre Ajman, Ajman', lat: 25.39974, lng: 55.47889, color: '#00754A', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://starbucks.ae' },
    // ---- Fujairah ----
    { id: 'ae-the-orangery-fujairah-city', name: 'The Orangery', area: 'Fujairah City, Fujairah', lat: 25.1287, lng: 56.3265, color: '#E67E22', logo_url: 'https://ui-avatars.com/api/?name=The%20Orangery&background=E67E22&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-starbucks-city-centre-fujairah', name: 'Starbucks', area: 'City Centre Fujairah, Fujairah', lat: 25.12568, lng: 56.30223, color: '#00754A', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://starbucks.ae' },
    // ---- Umm Al Quwain / Khor Fakkan / Kalba ----
    { id: 'ae-mez-cafe-mall-of-uaq', name: 'Mez Cafe', area: 'Mall of UAQ, Umm Al Quwain', lat: 25.52088, lng: 55.54405, color: '#2E7D7A', logo_url: 'https://ui-avatars.com/api/?name=Mez%20Cafe&background=2E7D7A&color=FFFFFF&size=512&bold=true&format=png' },
    { id: 'ae-fen-caf-restaurant-al-suhub-rest-house', name: 'Fen Café & Restaurant', area: 'Al Suhub Rest House, Khor Fakkan', lat: 25.36042, lng: 56.32359, color: '#385E4D', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://visitsharjah.com' },
    { id: 'ae-fen-caf-restaurant-kalba-ice-factory', name: 'Fen Café & Restaurant', area: 'Kalba Ice Factory, Kalba', lat: 25.0078, lng: 56.3617, color: '#385E4D', logo_url: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://visitsharjah.com' },
  ],
};

// region key ('NL' | 'AE' | …) → the venue array (falls back to NL). Tolerates
// the legacy 'UAE' key and any casing.
export function getNotYetStores(region) {
  const key = String(region || '').toUpperCase();
  if (key === 'UAE') return NOT_YET_STORES.AE;
  return NOT_YET_STORES[key] || NOT_YET_STORES.NL;
}
