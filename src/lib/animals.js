/* ─────────────────────────────────────────────────────────────────────
 * Anonymous identity — a playful "adjective + animal" name (e.g. "Bouncy
 * Axolotl") with a matching emoji avatar in a soft colour.
 *
 * 50 adjectives × 50 animals (product-supplied). A new user is assigned one
 * random adjective and one random animal; `animal_index` (stored on the user
 * row) points into ANIMALS. We also resolve the avatar from the animal word in
 * the name, so the icon always matches what's written even for older names.
 *
 * Icons: an emoji per animal (colourful, recognisable, and it scales to all 50
 * without shipping 50 hand-drawn SVGs). A handful of animals have no dedicated
 * emoji and use the closest match; the soft background colour + the name keep
 * them distinct.
 * ───────────────────────────────────────────────────────────────────── */

export const ADJECTIVES = [
  'Bouncy', 'Wiggly', 'Zesty', 'Jolly', 'Sparkly', 'Peppy', 'Snuggly', 'Dizzy', 'Silly', 'Cheery',
  'Mellow', 'Toasty', 'Nifty', 'Fuzzy', 'Bubbly', 'Perky', 'Wobbly', 'Sunny', 'Goofy', 'Chirpy',
  'Sprightly', 'Cozy', 'Giggly', 'Plucky', 'Twinkly', 'Scooty', 'Fluffy', 'Munchy', 'Noodly', 'Breezy',
  'Dapper', 'Hoppy', 'Jumpy', 'Poppy', 'Jazzy', 'Quirky', 'Glowy', 'Tippy', 'Wavy', 'Clever',
  'Mighty', 'Tiny', 'Swift', 'Dreamy', 'Buttoned', 'Curious', 'Gentle', 'Happy', 'Playful', 'Whimsical',
];

/* name, emoji avatar, and a soft background colour for the avatar circle. */
export const ANIMALS = [
  { name: 'Axolotl',   emoji: '🐠', bg: '#FFB3C6' },
  { name: 'Capybara',  emoji: '🦫', bg: '#FFC7A8' },
  { name: 'Quokka',    emoji: '🐹', bg: '#FFD79A' },
  { name: 'Penguin',   emoji: '🐧', bg: '#F6E79A' },
  { name: 'Puffin',    emoji: '🐦', bg: '#DCEE9C' },
  { name: 'Otter',     emoji: '🦦', bg: '#B9E89E' },
  { name: 'Wombat',    emoji: '🐨', bg: '#9EE7BC' },
  { name: 'Meerkat',   emoji: '🐿️', bg: '#9CE6DA' },
  { name: 'Alpaca',    emoji: '🦙', bg: '#A4DEF0' },
  { name: 'Koala',     emoji: '🐨', bg: '#A9CBF6' },
  { name: 'Panda',     emoji: '🐼', bg: '#BCC1F3' },
  { name: 'Turtle',    emoji: '🐢', bg: '#D6BAF0' },
  { name: 'Hedgehog',  emoji: '🦔', bg: '#EDB6E4' },
  { name: 'Squirrel',  emoji: '🐿️', bg: '#FFB0AE' },
  { name: 'Raccoon',   emoji: '🦝', bg: '#E9D3A6' },
  { name: 'Seal',      emoji: '🦭', bg: '#CBD1DB' },
  { name: 'Dolphin',   emoji: '🐬', bg: '#FFB3C6' },
  { name: 'Narwhal',   emoji: '🐳', bg: '#FFC7A8' },
  { name: 'Llama',     emoji: '🦙', bg: '#FFD79A' },
  { name: 'Gecko',     emoji: '🦎', bg: '#F6E79A' },
  { name: 'Chameleon', emoji: '🦎', bg: '#DCEE9C' },
  { name: 'Platypus',  emoji: '🦆', bg: '#B9E89E' },
  { name: 'Kangaroo',  emoji: '🦘', bg: '#9EE7BC' },
  { name: 'Wallaby',   emoji: '🦘', bg: '#9CE6DA' },
  { name: 'Hamster',   emoji: '🐹', bg: '#A4DEF0' },
  { name: 'Ferret',    emoji: '🦡', bg: '#A9CBF6' },
  { name: 'Marmot',    emoji: '🐹', bg: '#BCC1F3' },
  { name: 'Beaver',    emoji: '🦫', bg: '#D6BAF0' },
  { name: 'Badger',    emoji: '🦡', bg: '#EDB6E4' },
  { name: 'Fox',       emoji: '🦊', bg: '#FFB0AE' },
  { name: 'Rabbit',    emoji: '🐰', bg: '#E9D3A6' },
  { name: 'Duck',      emoji: '🦆', bg: '#CBD1DB' },
  { name: 'Goose',     emoji: '🪿', bg: '#FFB3C6' },
  { name: 'Flamingo',  emoji: '🦩', bg: '#FFC7A8' },
  { name: 'Toucan',    emoji: '🦜', bg: '#FFD79A' },
  { name: 'Parrot',    emoji: '🦜', bg: '#F6E79A' },
  { name: 'Kiwi',      emoji: '🥝', bg: '#DCEE9C' },
  { name: 'Sloth',     emoji: '🦥', bg: '#B9E89E' },
  { name: 'Tapir',     emoji: '🐽', bg: '#9EE7BC' },
  { name: 'Manatee',   emoji: '🐋', bg: '#9CE6DA' },
  { name: 'Mongoose',  emoji: '🐾', bg: '#A4DEF0' },
  { name: 'Lemur',     emoji: '🐒', bg: '#A9CBF6' },
  { name: 'Opossum',   emoji: '🐀', bg: '#BCC1F3' },
  { name: 'Armadillo', emoji: '🐾', bg: '#D6BAF0' },
  { name: 'Porcupine', emoji: '🦔', bg: '#EDB6E4' },
  { name: 'Pangolin',  emoji: '🐾', bg: '#FFB0AE' },
  { name: 'Moose',     emoji: '🫎', bg: '#E9D3A6' },
  { name: 'Yak',       emoji: '🐂', bg: '#CBD1DB' },
  { name: 'Octopus',   emoji: '🐙', bg: '#FFB3C6' },
  { name: 'Seahorse',  emoji: '🐠', bg: '#FFC7A8' },
];

const BY_NAME = Object.fromEntries(ANIMALS.map((a, i) => [a.name.toLowerCase(), i]));

function randOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* A fresh identity: one random adjective + one random animal. */
export function generateProfile() {
  const animalIndex = Math.floor(Math.random() * ANIMALS.length);
  const displayName = `${randOf(ADJECTIVES)} ${ANIMALS[animalIndex].name}`;
  return { animalIndex, displayName };
}

/* Resolve the avatar for a profile: match the animal word in the name first
 * (so any "… <Animal>" name gets the right icon), else the stored index. */
export function animalForProfile(profile) {
  const last = String(profile?.displayName || '').trim().split(/\s+/).pop()?.toLowerCase();
  if (last && BY_NAME[last] != null) return ANIMALS[BY_NAME[last]];
  const idx = Number(profile?.animalIndex);
  return ANIMALS[(Number.isFinite(idx) ? idx : 0) % ANIMALS.length] || ANIMALS[0];
}
