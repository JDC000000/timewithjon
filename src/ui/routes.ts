// src/ui/routes.ts (U1): the paths the shared chrome links to (header, admin nav, 404). One place, so a lane that
// moves a page changes it here through U1.
export const ROUTES = {
  home: '/',
  /** S04, the activity menu page (lane U2 PR2); `/menu#<section>` = a course, `/menu#<slug>` = a dish's sheet. */
  menu: '/menu',
  /** S12b, the printable wine tag (lane U2 builds the page); the no-gifts P.S. links here (decision 45). */
  tag: '/tag',
  /** S11 "Sent.", the page after a request; the tag's ‹ back link returns here (v2.2 changelog 45/47a). */
  sent: '/sent',
  story: '/#story',
  admin: {
    requests: '/admin',
    requestsPrefix: '/admin/requests',
    season: '/admin/season',
    links: '/admin/invites',
    stories: '/admin/stories',
    settings: '/admin/settings',
    signIn: '/admin/sign-in',
  },
} as const;
