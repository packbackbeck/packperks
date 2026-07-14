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
  { name: 'Axolotl',   emoji: '🐠', bg: '#FBE0EC' },
  { name: 'Capybara',  emoji: '🦫', bg: '#EBDFCB' },
  { name: 'Quokka',    emoji: '🐹', bg: '#F7E6CE' },
  { name: 'Penguin',   emoji: '🐧', bg: '#DCE8F4' },
  { name: 'Puffin',    emoji: '🐦', bg: '#E4EEF6' },
  { name: 'Otter',     emoji: '🦦', bg: '#E9DFD0' },
  { name: 'Wombat',    emoji: '🐨', bg: '#E7DCD1' },
  { name: 'Meerkat',   emoji: '🐿️', bg: '#F1E3CA' },
  { name: 'Alpaca',    emoji: '🦙', bg: '#F4E7D5' },
  { name: 'Koala',     emoji: '🐨', bg: '#E3E8E8' },
  { name: 'Panda',     emoji: '🐼', bg: '#ECECEC' },
  { name: 'Turtle',    emoji: '🐢', bg: '#DBEBDA' },
  { name: 'Hedgehog',  emoji: '🦔', bg: '#EEE1CE' },
  { name: 'Squirrel',  emoji: '🐿️', bg: '#F1E1CB' },
  { name: 'Raccoon',   emoji: '🦝', bg: '#E5E5E7' },
  { name: 'Seal',      emoji: '🦭', bg: '#E1E8ED' },
  { name: 'Dolphin',   emoji: '🐬', bg: '#D7EBF4' },
  { name: 'Narwhal',   emoji: '🐳', bg: '#DBEAF3' },
  { name: 'Llama',     emoji: '🦙', bg: '#F2E4D2' },
  { name: 'Gecko',     emoji: '🦎', bg: '#E0EFD7' },
  { name: 'Chameleon', emoji: '🦎', bg: '#E6F1D6' },
  { name: 'Platypus',  emoji: '🦆', bg: '#E8DFCE' },
  { name: 'Kangaroo',  emoji: '🦘', bg: '#F1E0CD' },
  { name: 'Wallaby',   emoji: '🦘', bg: '#F3E3CF' },
  { name: 'Hamster',   emoji: '🐹', bg: '#F8E9D0' },
  { name: 'Ferret',    emoji: '🦡', bg: '#EAE0D1' },
  { name: 'Marmot',    emoji: '🐹', bg: '#F1E5D1' },
  { name: 'Beaver',    emoji: '🦫', bg: '#E8DCC7' },
  { name: 'Badger',    emoji: '🦡', bg: '#E6E6E6' },
  { name: 'Fox',       emoji: '🦊', bg: '#FBE3CD' },
  { name: 'Rabbit',    emoji: '🐰', bg: '#F4E7DE' },
  { name: 'Duck',      emoji: '🦆', bg: '#F6ECCE' },
  { name: 'Goose',     emoji: '🪿', bg: '#EFEBD9' },
  { name: 'Flamingo',  emoji: '🦩', bg: '#FCE0E6' },
  { name: 'Toucan',    emoji: '🦜', bg: '#E5F0D8' },
  { name: 'Parrot',    emoji: '🦜', bg: '#DEEFDC' },
  { name: 'Kiwi',      emoji: '🥝', bg: '#E7ECD4' },
  { name: 'Sloth',     emoji: '🦥', bg: '#EAE2D1' },
  { name: 'Tapir',     emoji: '🐽', bg: '#ECE0D5' },
  { name: 'Manatee',   emoji: '🐋', bg: '#DDEAEF' },
  { name: 'Mongoose',  emoji: '🐾', bg: '#EEE2CD' },
  { name: 'Lemur',     emoji: '🐒', bg: '#E8E2D5' },
  { name: 'Opossum',   emoji: '🐀', bg: '#E7E5E1' },
  { name: 'Armadillo', emoji: '🐾', bg: '#EEE1CE' },
  { name: 'Porcupine', emoji: '🦔', bg: '#EAE0CD' },
  { name: 'Pangolin',  emoji: '🐾', bg: '#EEE3CC' },
  { name: 'Moose',     emoji: '🫎', bg: '#E8DDCE' },
  { name: 'Yak',       emoji: '🐂', bg: '#E7DFD1' },
  { name: 'Octopus',   emoji: '🐙', bg: '#F3DDE7' },
  { name: 'Seahorse',  emoji: '🐠', bg: '#DBEBF0' },
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
