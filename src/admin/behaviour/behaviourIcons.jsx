import {
  Activity, ArrowLeftRight, Banknote, Coins, Cookie, CupSoda, DoorOpen, Eye, Gift, HandCoins,
  HeartHandshake, Hourglass, Layers, Link2Off, LogIn, Mail, MailCheck, MousePointerClick, ReceiptText,
  Repeat, Repeat2, ScanLine, ScanQrCode, Share2, SquareArrowOutUpRight, Timer, Clock, UserCheck, Users,
  Wallet, WifiOff,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────
 * Icon and colour for each User Behaviour metric.
 *
 * Icons are lucide components; tones are the ui.css chip colours
 * (ui-tone--*). Related metrics share a tone so the tile grid reads in
 * families: scanning is violet, coming back is green, claiming is amber
 * and orange, the audience is teal and sky, problems are rose.
 * ───────────────────────────────────────────────────────────────────── */

export const METRIC_LOOK = {
  // Standard and Bring Your Own venues
  qr_scan_receipts:     { icon: ScanQrCode, tone: 'violet' },
  second_scan:          { icon: Repeat, tone: 'emerald' },
  avg_second_scan:      { icon: Timer, tone: 'sky' },
  cup_spent:            { icon: CupSoda, tone: 'orange' },
  rewards_claim:        { icon: Gift, tone: 'amber' },
  active_users:         { icon: UserCheck, tone: 'teal' },
  emails_active:        { icon: MailCheck, tone: 'lime' },
  emails_input:         { icon: Mail, tone: 'lime' },
  changed_rewards:      { icon: ArrowLeftRight, tone: 'amber' },
  qr_scan_cups:         { icon: ScanLine, tone: 'violet' },
  third_scan:           { icon: Layers, tone: 'emerald' },
  third_scan_returning: { icon: Repeat2, tone: 'emerald' },
  rewards_share:        { icon: Coins, tone: 'amber' },
  donation_share:       { icon: HeartHandshake, tone: 'rose' },
  ignored_receipts:     { icon: ReceiptText, tone: 'slate' },
  avg_session:          { icon: Clock, tone: 'sky' },
  button_clicks:        { icon: MousePointerClick, tone: 'violet' },
  entry_source:         { icon: LogIn, tone: 'sky' },
  cookie_rejected:      { icon: Cookie, tone: 'rose' },
  visitor_rate:         { icon: Eye, tone: 'slate' },
  audience_split:       { icon: Users, tone: 'teal' },
  last_screen:          { icon: DoorOpen, tone: 'slate' },
  impact_shares:        { icon: Share2, tone: 'emerald' },
  inapp_redirect:       { icon: SquareArrowOutUpRight, tone: 'orange' },

  // Deferred Tikkie venues
  tk_collect:           { icon: HandCoins, tone: 'emerald' },
  tk_email_capture:     { icon: MailCheck, tone: 'lime' },
  tk_audience:          { icon: Users, tone: 'teal' },
  tk_account_conv:      { icon: UserCheck, tone: 'sky' },
  tk_cookie_rejected:   { icon: Cookie, tone: 'rose' },
  tk_attached:          { icon: Wallet, tone: 'violet' },
  tk_pending_resolved:  { icon: Hourglass, tone: 'amber' },
  tk_backup_share:      { icon: WifiOff, tone: 'orange' },
  tk_expired:           { icon: Link2Off, tone: 'rose' },
  tk_avg_payout:        { icon: Banknote, tone: 'emerald' },
  tk_avg_cups:          { icon: CupSoda, tone: 'orange' },
};

export const DEFAULT_LOOK = { icon: Activity, tone: 'slate' };
