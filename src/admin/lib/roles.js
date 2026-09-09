/* Role constants shared by the admin shell and the sidebar.

   Its own module because both the sidebar (which hides tabs) and the shell
   (which guards hash routing) need the same list, and a component file that
   also exports constants breaks React Fast Refresh. */

/* The vendor's pages. Hiding a tab in the sidebar is a UI courtesy, not
   access control — #settings must not resolve for a vendor just because
   they typed it, so the shell guards routing with this too.

   Rewards & offers and System health are deliberately NOT here: the first
   is an editing surface a read-only role has no use for, and the second
   reports on PackPerks' own plumbing, which is our problem to watch, not
   the venue's. What is left is the three pages that answer "how is my
   store doing". */
export const VENDOR_TABS = ['overview', 'reports', 'behaviour'];
