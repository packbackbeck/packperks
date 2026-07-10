// Customer-app reward fallback.
//
// This used to hold the Burger King starter menu (Chicken Sandwich, Veggie
// Nuggets, Big King) and was shown whenever a venue's real rewards hadn't
// loaded yet — which meant any unresolved / slug-less visit flashed a
// competitor's food at a café's customers (and paired with the Burger King
// org fallback in getDefaultOrg). Both are removed: rewards now come solely
// from the active venue's published config. Nothing to fall back to.
export const rewards = [];
