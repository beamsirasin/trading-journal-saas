/**
 * PROTOTYPE COPY — local to the prototype, deliberately not `messages/*.json`.
 *
 * The brief forbids touching the localization architecture, so nothing here is
 * a translation key and next-intl never sees it. It exists for one reason: the
 * seven-column journal is the densest layout in the redesign, and Thai sets
 * wider than English at the same point size. A layout that only ever renders
 * "Strategy / Setup" has not been tested against "กลยุทธ์ / เซ็ตอัพ".
 *
 * Where the product ALREADY has a Thai string for a concept — column headings,
 * result words, lifecycle words, navigation — the value below is copied
 * verbatim from `messages/th.json` so the stress test uses real product copy
 * rather than invented copy. Strings the redesign introduces are approximations
 * written for LAYOUT review; they are not reviewed product copy and must not be
 * lifted into `messages/th.json` as-is.
 *
 * Scope: the Trade Log list surface only. Trade details and the recording forms
 * render English in this prototype — see the design-review notes.
 */

export type PrototypeLocale = 'en' | 'th';

export interface PrototypeCopy {
  readonly pageTitle: string;
  readonly logTrade: string;
  readonly account: string;
  readonly allAccounts: string;
  readonly dateRange: string;
  readonly allTime: string;

  readonly stateAll: string;
  readonly stateOpen: string;
  readonly stateClosed: string;

  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly filters: string;
  readonly sort: string;
  readonly sortNewest: string;
  readonly clearFilters: string;

  readonly summaryTrades: string;
  readonly summaryNetPnl: string;
  readonly summaryTotalR: string;
  readonly summaryOpenTrades: string;
  readonly summaryPartiallyClosed: string;
  /** The heading a PARTIAL total wears, so it is never read as the whole. */
  readonly summaryKnownNetPnl: string;
  readonly summaryNoClosedTrades: string;
  readonly summaryNotRecorded: string;
  readonly summaryMultipleCurrencies: string;
  readonly summarySelectOneAccount: string;
  /** `{with}` of `{closed}` — coverage of the money aggregate. */
  readonly summaryMoneyCoverage: string;
  /** `{with}` of `{closed}` — coverage of the R aggregate. */
  readonly summaryRCoverage: string;
  /** `{count}` — how many carry no value. */
  readonly summaryNotRecordedCount: string;

  readonly sortOldest: string;
  readonly sortSymbol: string;
  readonly sortRHigh: string;
  readonly sortRLow: string;

  readonly colTrade: string;
  readonly colActivity: string;
  readonly colStatus: string;
  readonly colNetPnl: string;
  readonly colActualR: string;
  readonly colStrategySetup: string;
  readonly colFollowUp: string;

  readonly timezoneNote: string;
  readonly realized: string;
  readonly notRecorded: string;
  readonly notAvailable: string;
  readonly noStrategy: string;
  readonly closedOfPosition: string;

  readonly statusOpen: string;
  readonly statusPartiallyClosed: string;
  readonly statusClosed: string;
  readonly statusNeedsDetails: string;
  readonly statusCanceled: string;

  readonly outcomeWin: string;
  readonly outcomeLoss: string;
  readonly outcomeBreakEven: string;
  readonly outcomeUnresolved: string;

  readonly followUpCompleteDetails: string;
  readonly followUpAddSystemResult: string;
  readonly followUpAddReviewNote: string;
  readonly followUpAddStrategy: string;

  readonly paginationRange: string;
  readonly previous: string;
  readonly next: string;

  readonly journalLabel: string;
}

const EN: PrototypeCopy = {
  pageTitle: 'Trades',
  logTrade: 'Log a trade',
  account: 'Live · FTMO 100K',
  allAccounts: 'All accounts',
  dateRange: 'All time',
  allTime: 'All time',

  stateAll: 'All',
  stateOpen: 'Open',
  stateClosed: 'Closed',

  searchLabel: 'Search trades',
  searchPlaceholder: 'Symbol or notes',
  filters: 'Filters',
  sort: 'Newest activity',
  sortNewest: 'Newest activity',
  clearFilters: 'Clear filters',

  summaryTrades: 'trades',
  summaryNetPnl: 'Net P&L',
  summaryTotalR: 'Total R',
  summaryOpenTrades: 'open trades',
  summaryPartiallyClosed: 'partially closed',
  summaryKnownNetPnl: 'Known net P&L',
  summaryNoClosedTrades: 'No closed trades',
  summaryNotRecorded: 'Not recorded',
  summaryMultipleCurrencies: 'Multiple currencies',
  summarySelectOneAccount: 'Select one account',
  summaryMoneyCoverage: '{with} of {closed} closed trades have monetary results',
  summaryRCoverage: '{with} of {closed} have an R value',
  summaryNotRecordedCount: '{count} not recorded',

  sortOldest: 'Oldest activity',
  sortSymbol: 'Symbol A–Z',
  sortRHigh: 'Actual R high–low',
  sortRLow: 'Actual R low–high',

  colTrade: 'Trade',
  colActivity: 'Activity',
  colStatus: 'Status',
  colNetPnl: 'Net P&L',
  colActualR: 'Actual R',
  colStrategySetup: 'Strategy / Setup',
  colFollowUp: 'Follow-up',

  timezoneNote: 'Times in Asia/Bangkok · GMT+7',
  realized: 'Realized',
  notRecorded: 'Not recorded',
  notAvailable: 'Not available',
  noStrategy: 'No strategy',
  closedOfPosition: 'closed',

  statusOpen: 'Open',
  statusPartiallyClosed: 'Partially closed',
  statusClosed: 'Closed',
  statusNeedsDetails: 'Needs details',
  statusCanceled: 'Canceled',

  outcomeWin: 'Win',
  outcomeLoss: 'Loss',
  outcomeBreakEven: 'Break-even',
  outcomeUnresolved: 'No result',

  followUpCompleteDetails: 'Complete details',
  followUpAddSystemResult: 'Add system result',
  followUpAddReviewNote: 'Add review note',
  followUpAddStrategy: 'Add strategy',

  paginationRange: '1–25 of 124 trades',
  previous: 'Previous',
  next: 'Next',

  journalLabel: 'Trade journal',
};

const TH: PrototypeCopy = {
  pageTitle: 'ออเดอร์',
  logTrade: 'บันทึกออเดอร์',
  account: 'Live · FTMO 100K',
  allAccounts: 'ทุกบัญชี',
  dateRange: 'ทั้งหมด',
  allTime: 'ทั้งหมด',

  stateAll: 'ทั้งหมด',
  stateOpen: 'เปิดอยู่',
  stateClosed: 'ปิดแล้ว',

  searchLabel: 'ค้นหาออเดอร์',
  searchPlaceholder: 'สินทรัพย์หรือบันทึก',
  filters: 'ตัวกรอง',
  sort: 'ล่าสุดก่อน',
  sortNewest: 'ล่าสุดก่อน',
  clearFilters: 'ล้างตัวกรอง',

  summaryTrades: 'ออเดอร์',
  summaryNetPnl: 'กำไร/ขาดทุนสุทธิ',
  summaryTotalR: 'R รวม',
  summaryOpenTrades: 'ออเดอร์ที่เปิดอยู่',
  summaryPartiallyClosed: 'ปิดบางส่วน',
  summaryKnownNetPnl: 'กำไร/ขาดทุนสุทธิเท่าที่ทราบ',
  summaryNoClosedTrades: 'ยังไม่มีออเดอร์ที่ปิดแล้ว',
  summaryNotRecorded: 'ไม่ได้บันทึก',
  summaryMultipleCurrencies: 'หลายสกุลเงิน',
  summarySelectOneAccount: 'เลือกบัญชีเดียว',
  summaryMoneyCoverage: 'ออเดอร์ที่ปิดแล้ว {with} จาก {closed} รายการมีผลเป็นจำนวนเงิน',
  summaryRCoverage: '{with} จาก {closed} รายการมีค่า R',
  summaryNotRecordedCount: 'ไม่ได้บันทึก {count} รายการ',

  sortOldest: 'เก่าสุดก่อน',
  sortSymbol: 'สินทรัพย์ ก–ฮ',
  sortRHigh: 'R มากไปน้อย',
  sortRLow: 'R น้อยไปมาก',

  colTrade: 'ออเดอร์',
  colActivity: 'วันที่',
  colStatus: 'สถานะ',
  colNetPnl: 'กำไร/ขาดทุน',
  colActualR: 'R ที่ทำได้',
  colStrategySetup: 'กลยุทธ์ / เซ็ตอัพ',
  colFollowUp: 'สิ่งที่ต้องทำต่อ',

  timezoneNote: 'เวลาตามเขต Asia/Bangkok · GMT+7',
  realized: 'ที่รับรู้แล้ว',
  notRecorded: 'ไม่ได้บันทึก',
  notAvailable: 'ไม่มีข้อมูล',
  noStrategy: 'ไม่มีกลยุทธ์',
  closedOfPosition: 'ปิดแล้ว',

  statusOpen: 'เปิดอยู่',
  statusPartiallyClosed: 'ปิดบางส่วน',
  statusClosed: 'ปิดแล้ว',
  statusNeedsDetails: 'ต้องเพิ่มรายละเอียด',
  statusCanceled: 'ยกเลิก',

  outcomeWin: 'ชนะ',
  outcomeLoss: 'แพ้',
  outcomeBreakEven: 'เท่าทุน',
  outcomeUnresolved: 'ไม่มีผลลัพธ์',

  followUpCompleteDetails: 'เพิ่มรายละเอียด',
  followUpAddSystemResult: 'เพิ่มผลตามระบบ',
  followUpAddReviewNote: 'เพิ่มบันทึกทบทวน',
  followUpAddStrategy: 'เพิ่มกลยุทธ์',

  paginationRange: '1–25 จาก 124 ออเดอร์',
  previous: 'ก่อนหน้า',
  next: 'ถัดไป',

  journalLabel: 'สมุดบันทึกออเดอร์',
};

export function prototypeCopy(locale: PrototypeLocale): PrototypeCopy {
  return locale === 'th' ? TH : EN;
}

/** Named-placeholder interpolation — `{count}`, `{with}`, `{closed}`. */
export function fill(template: string, values: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** The sort options, in the reading language. Keyed by `SortKey` from `query.ts`. */
export function sortLabel(
  copy: PrototypeCopy,
  key: 'newest' | 'oldest' | 'symbol' | 'actual_r_high' | 'actual_r_low',
): string {
  switch (key) {
    case 'newest':
      return copy.sortNewest;
    case 'oldest':
      return copy.sortOldest;
    case 'symbol':
      return copy.sortSymbol;
    case 'actual_r_high':
      return copy.sortRHigh;
    case 'actual_r_low':
      return copy.sortRLow;
  }
}

export function statusLabel(
  copy: PrototypeCopy,
  lifecycle: 'open' | 'partially_closed' | 'closed' | 'needs_details' | 'canceled',
): string {
  switch (lifecycle) {
    case 'open':
      return copy.statusOpen;
    case 'partially_closed':
      return copy.statusPartiallyClosed;
    case 'closed':
      return copy.statusClosed;
    case 'needs_details':
      return copy.statusNeedsDetails;
    case 'canceled':
      return copy.statusCanceled;
  }
}

export function outcomeLabel(
  copy: PrototypeCopy,
  outcome: 'win' | 'loss' | 'break_even' | 'unresolved',
): string {
  switch (outcome) {
    case 'win':
      return copy.outcomeWin;
    case 'loss':
      return copy.outcomeLoss;
    case 'break_even':
      return copy.outcomeBreakEven;
    case 'unresolved':
      return copy.outcomeUnresolved;
  }
}

export function followUpLabel(
  copy: PrototypeCopy,
  followUp: 'complete_details' | 'add_system_result' | 'add_review_note' | 'add_strategy' | 'none',
): string {
  switch (followUp) {
    case 'complete_details':
      return copy.followUpCompleteDetails;
    case 'add_system_result':
      return copy.followUpAddSystemResult;
    case 'add_review_note':
      return copy.followUpAddReviewNote;
    case 'add_strategy':
      return copy.followUpAddStrategy;
    case 'none':
      return '—';
  }
}
