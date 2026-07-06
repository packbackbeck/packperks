// Curated "coming soon" venues shown as locked placeholder stores on the
// Stores map/list so a new group's map doesn't look empty. Not participating
// yet — display only. Coordinates are neighbourhood-level (placeholder pins).
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
  UAE: [
    // ---- Dubai ----
    { name: 'Common Grounds', area: 'JLT, Dubai', lat: 25.0693, lng: 55.1440 },
    { name: 'Friends Avenue Cafe', area: 'JLT, Dubai', lat: 25.0688, lng: 55.1421 },
    { name: '1762 Stripped', area: 'JLT, Dubai', lat: 25.0701, lng: 55.1435 },
    { name: 'Origins Coffee', area: 'DIFC, Dubai', lat: 25.2118, lng: 55.2790 },
    { name: 'Lulu & the Beanstalk', area: 'DIFC, Dubai', lat: 25.2136, lng: 55.2811 },
    { name: 'Drop Coffee', area: 'DIFC, Dubai', lat: 25.2109, lng: 55.2782 },
    { name: 'Cafe Bateel', area: 'Downtown Dubai', lat: 25.1935, lng: 55.2795 },
    { name: 'Apricot Delicatessen', area: 'Downtown Dubai', lat: 25.1962, lng: 55.2770 },
    { name: '% Arabica', area: 'Downtown Dubai', lat: 25.1972, lng: 55.2796 },
    { name: 'Stomping Grounds', area: 'Jumeirah, Dubai', lat: 25.2085, lng: 55.2570 },
    { name: 'Comptoir 102', area: 'Jumeirah, Dubai', lat: 25.2166, lng: 55.2520 },
    { name: 'HOYA', area: 'Jumeirah, Dubai', lat: 25.2011, lng: 55.2434 },
    { name: "Tania's Teahouse", area: 'Jumeirah, Dubai', lat: 25.2055, lng: 55.2461 },
    { name: 'Nightjar Coffee', area: 'Alserkal Avenue, Al Quoz, Dubai', lat: 25.1436, lng: 55.2352 },
    { name: 'Wild & The Moon', area: 'Alserkal Avenue, Al Quoz, Dubai', lat: 25.1441, lng: 55.2344 },
    { name: 'Roseleaf Cafe', area: 'Al Quoz, Dubai', lat: 25.1592, lng: 55.2431 },
    { name: 'Boston Lane', area: 'Al Barsha, Dubai', lat: 25.1128, lng: 55.1966 },
    { name: 'One Life Kitchen & Cafe', area: 'Dubai Design District, Dubai', lat: 25.1868, lng: 55.2985 },
    { name: 'Surf House Dubai', area: 'Umm Suqeim, Dubai', lat: 25.1418, lng: 55.1912 },
    { name: 'Joe & The Juice', area: 'City Walk, Dubai', lat: 25.2044, lng: 55.2621 },
    // ---- Abu Dhabi ----
    { name: 'Brunch & Cake', area: 'Al Bateen, Abu Dhabi', lat: 24.4581, lng: 54.3268 },
    { name: 'Parallel Cafe', area: 'Al Bateen, Abu Dhabi', lat: 24.4523, lng: 54.3241 },
    { name: "Sanderson's Cafe", area: 'Al Reem Island, Abu Dhabi', lat: 24.4986, lng: 54.4062 },
    { name: 'Joud Coffee', area: 'Al Nahyan, Abu Dhabi', lat: 24.4712, lng: 54.3721 },
    { name: 'Tom & Serg', area: 'Al Maryah Island, Abu Dhabi', lat: 24.5008, lng: 54.3896 },
    { name: 'RAW Coffee Company', area: 'Al Mushrif, Abu Dhabi', lat: 24.4489, lng: 54.3810 },
  ],
};

// region: 'NL' | 'UAE' → the venue array (falls back to NL).
export function getNotYetStores(region) {
  return NOT_YET_STORES[region] || NOT_YET_STORES.NL;
}
