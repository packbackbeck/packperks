/* ─────────────────────────────────────────────────────────────────────
 * Per-metric icons for the User Behaviour tiles.
 *
 * Each metric id maps to a small line icon that hints at what it measures
 * (a QR for scan rates, a clock for timing, a gift for rewards, …). All
 * share one stroke style so they sit consistently in the tile corner and
 * in the detail modal. A neutral fallback covers any unmapped id.
 * ───────────────────────────────────────────────────────────────────── */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const Qr = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 21v-4" />
  </svg>
);
const Return = (p) => (
  <svg {...base} {...p}>
    <path d="M3 11a8 8 0 0 1 13.7-5.6L21 9" /><path d="M21 5v4h-4" />
    <path d="M21 13a8 8 0 0 1-13.7 5.6L3 15" /><path d="M3 19v-4h4" />
  </svg>
);
const Clock = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
  </svg>
);
const Cup = (p) => (
  <svg {...base} {...p}>
    <path d="M6 4h12l-1.2 14.4a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 4z" /><path d="M5 8h14" />
  </svg>
);
const CupCheck = (p) => (
  <svg {...base} {...p}>
    <path d="M6 4h12l-1.2 14.4a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 4z" /><path d="M9 11l2 2 4-4" />
  </svg>
);
const Gift = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="9" width="18" height="12" rx="1.4" /><path d="M3 13h18M12 9v12" />
    <path d="M12 9S10.6 4.6 8.3 5a2 2 0 0 0 .2 4z" /><path d="M12 9s1.4-4.4 3.7-4a2 2 0 0 1-.2 4z" />
  </svg>
);
const Envelope = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" />
  </svg>
);
const Swap = (p) => (
  <svg {...base} {...p}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
);
const Layers = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
  </svg>
);
const ReturnUsers = (p) => (
  <svg {...base} {...p}>
    <path d="M3 10a7 7 0 0 1 12-4l3 3" /><path d="M18 5v4h-4" />
    <circle cx="9" cy="16" r="2" /><path d="M5 22a4 4 0 0 1 8 0" /><circle cx="17" cy="15" r="1.6" /><path d="M14.5 21a3 3 0 0 1 5 0" />
  </svg>
);
const Coins = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3" />
    <path d="M9 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /><ellipse cx="15" cy="12" rx="6" ry="3" />
  </svg>
);
const Heart = (p) => (
  <svg {...base} {...p}>
    <path d="M12 20s-7-4.6-9.2-9A4.7 4.7 0 0 1 12 6.5 4.7 4.7 0 0 1 21.2 11C19 15.4 12 20 12 20z" />
  </svg>
);
const ReceiptOff = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3h12v15l-2.2-1.4L13.6 18l-2.3-1.4M6 3v9" /><path d="M9 7h6M9 11h4" /><line x1="3" y1="3" x2="21" y2="21" />
  </svg>
);
const Stopwatch = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13" r="8" /><path d="M12 13V9M9 2h6M19 6l1.5-1.5" />
  </svg>
);
const Click = (p) => (
  <svg {...base} {...p}>
    <path d="M9 3v4M5 5l2.5 2.5M3 9h4M5 13l2.5-2.5" /><path d="M11 11l9 3.5-3.8 1.4L19 20l-2.5 1.4-2.4-4.1L11 20z" />
  </svg>
);
const Phone = (p) => (
  <svg {...base} {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" />
  </svg>
);
const Share = (p) => (
  <svg {...base} {...p}>
    <circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" />
    <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
  </svg>
);
const Entry = (p) => (
  <svg {...base} {...p}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
  </svg>
);
const UserCheck = (p) => (
  <svg {...base} {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="17 11 19 13 23 9" />
  </svg>
);
const Eye = (p) => (
  <svg {...base} {...p}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const Users = (p) => (
  <svg {...base} {...p}>
    <path d="M17 21v-2a4 4 0 0 0-3-3.87" /><path d="M9 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="7" cy="7" r="3" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const External = (p) => (
  <svg {...base} {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
const Chart = (p) => (
  <svg {...base} {...p}>
    <path d="M4 4v16h16" /><path d="M7 15l3.5-4 3 2.5L20 7" />
  </svg>
);

const ICONS = {
  qr_scan_receipts: Qr,
  second_scan: Return,
  avg_second_scan: Clock,
  cup_spent: Cup,
  rewards_claim: Gift,
  emails_input: Envelope,
  changed_rewards: Swap,
  qr_scan_cups: CupCheck,
  third_scan: Layers,
  third_scan_returning: ReturnUsers,
  rewards_share: Coins,
  donation_share: Heart,
  ignored_receipts: ReceiptOff,
  avg_session: Stopwatch,
  button_clicks: Click,
  last_screen: Phone,
  entry_source: Entry,
  active_users: UserCheck,
  visitor_rate: Eye,
  audience_split: Users,
  inapp_redirect: External,
  impact_shares: Share,
};

export default function MetricIcon({ id, ...props }) {
  const Cmp = ICONS[id] || Chart;
  return <Cmp {...props} />;
}
