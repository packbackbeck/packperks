/* Role constants shared by the admin shell and the sidebar.

   Its own module because both the sidebar (which hides tabs) and the shell
   (which guards hash routing) need the same list, and a component file that
   also exports constants breaks React Fast Refresh. */

/* The vendor's five pages. Hiding a tab in the sidebar is a UI courtesy,
   not access control — #settings must not resolve for a vendor just
   because they typed it, so the shell guards routing with this too. */
export const VENDOR_TABS = ['overview', 'rewards', 'reports', 'stats', 'behaviour'];
