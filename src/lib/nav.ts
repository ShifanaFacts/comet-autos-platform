import {
  LayoutDashboard,
  CalendarDays,
  LogIn,
  ClipboardList,
  ClipboardCheck,
  FileText,
  BadgeCheck,
  Users,
  Car,
  Cog,
  Truck,
  ShoppingCart,
  History,
  Receipt,
  Wallet,
  HandCoins,
  ChartPie,
  ReceiptText,
  Percent,
  IdCard,
  CalendarCheck,
  CalendarOff,
  Banknote,
  BarChart3,
  Settings,
  ShieldCheck,
  ScrollText,
  FileMinus,
  FileSpreadsheet,
  Landmark,
  Building2,
  BookOpen,
  CreditCard,
  Tags,
  BookText,
  CalendarCheck2,
  FolderOpen,
  NotebookPen,
  Scale,
  Sheet,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission needed to see the item (the page itself still checks on the server). */
  permission?: string;
  /** Module not built yet: shown muted with a "Soon" tag; the route shows a placeholder. */
  soon?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/*
 * The sidebar, grouped by how the workshop works. Items a user has no
 * permission for are not shown (hiding is convenience only — every page and
 * action enforces permissions on the server). Modules not built yet stay
 * listed, marked "Soon", so nothing silently disappears.
 */
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ label: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  /*
   * The four documents the workshop actually touches every day come first,
   * in the order they happen. The detailed lifecycle screens — inspections,
   * approvals, appointments — are still here, one group down, for the jobs
   * that use them.
   */
  {
    label: 'Daily work',
    items: [
      {
        label: 'Job Cards',
        href: '/job-cards',
        icon: ClipboardList,
        permission: 'job_card.view',
      },
      { label: 'Quotations', href: '/quotations', icon: FileText, permission: 'quotation.view' },
      {
        label: 'Sales invoices',
        href: '/finance/invoices',
        icon: Receipt,
        permission: 'invoice.view',
      },
      { label: 'Receipts', href: '/finance/payments', icon: Wallet, permission: 'payment.view' },
      {
        label: 'Credit notes',
        href: '/finance/credit-notes',
        icon: FileMinus,
        permission: 'credit_note.view',
      },
    ],
  },
  {
    label: 'Customers',
    items: [
      { label: 'Customers', href: '/customers', icon: Users, permission: 'customer.view' },
      { label: 'Vehicles', href: '/vehicles', icon: Car, permission: 'vehicle.view' },
    ],
  },
  {
    label: 'Workshop',
    items: [
      { label: 'New job card', href: '/check-in', icon: LogIn, permission: 'job_card.create' },
      {
        label: 'Appointments',
        href: '/appointments',
        icon: CalendarDays,
        permission: 'appointment.view',
      },
      {
        label: 'Inspections',
        href: '/inspections',
        icon: ClipboardCheck,
        permission: 'job_card.view',
      },
      { label: 'Approvals', href: '/approvals', icon: BadgeCheck, permission: 'quotation.view' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Parts', href: '/inventory/parts', icon: Cog, permission: 'inventory.view' },
      {
        label: 'Purchases',
        href: '/inventory/purchases',
        icon: ShoppingCart,
        permission: 'purchase.view',
      },
      {
        label: 'Suppliers',
        href: '/inventory/suppliers',
        icon: Truck,
        permission: 'inventory.view',
      },
      {
        label: 'Stock movements',
        href: '/inventory/movements',
        icon: History,
        permission: 'inventory.view',
      },
    ],
  },
  {
    label: 'Receivables & payables',
    items: [
      {
        label: 'Receivables',
        href: '/finance/outstanding',
        icon: HandCoins,
        permission: 'invoice.view',
      },
      {
        label: 'Payables',
        href: '/finance/payables',
        icon: Banknote,
        permission: 'supplier_payment.view',
      },
      {
        label: 'Expenses & bills',
        href: '/finance/expenses',
        icon: ReceiptText,
        permission: 'expense.view',
      },
      {
        label: 'Statements of account',
        href: '/finance/statements',
        icon: FileSpreadsheet,
        permission: 'invoice.view',
      },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { label: 'Financial overview', href: '/finance', icon: ChartPie, permission: 'invoice.view' },
      {
        label: 'Chart of accounts',
        href: '/finance/accounting?view=accounts',
        icon: BookOpen,
        permission: 'accounting.view',
      },
      {
        label: 'Tax codes',
        href: '/finance/accounting/tax-codes',
        icon: Tags,
        permission: 'settings.view',
      },
      {
        label: 'Payment modes',
        href: '/finance/accounting/payment-modes',
        icon: CreditCard,
        permission: 'settings.view',
      },
      {
        label: 'Journal entries',
        href: '/finance/accounting?view=journal',
        icon: NotebookPen,
        permission: 'accounting.view',
      },
      {
        label: 'General ledger',
        href: '/finance/accounting?view=ledger',
        icon: BookText,
        permission: 'accounting.view',
      },
      {
        label: 'Opening balances',
        href: '/finance/accounting/opening-balances',
        icon: FolderOpen,
        permission: 'accounting.view',
      },
      {
        label: 'Bank reconciliation',
        href: '/finance/bank-reconciliation',
        icon: Landmark,
        permission: 'accounting.view',
      },
      {
        label: 'Fixed assets',
        href: '/finance/fixed-assets',
        icon: Building2,
        permission: 'accounting.view',
      },
      {
        label: 'VAT returns',
        href: '/finance/vat',
        icon: Percent,
        permission: 'vat.view',
      },
      {
        label: 'Year-end closing',
        href: '/finance/accounting/year-end',
        icon: CalendarCheck2,
        permission: 'accounting.view',
      },
    ],
  },
  {
    label: 'Financial statements',
    items: [
      {
        label: 'Trial balance',
        href: '/finance/accounting?view=trial',
        icon: Sheet,
        permission: 'reports.view',
      },
      {
        label: 'Profit & loss',
        href: '/finance/accounting?view=profit',
        icon: TrendingUp,
        permission: 'reports.view',
      },
      {
        label: 'Balance sheet',
        href: '/finance/accounting?view=balance',
        icon: Scale,
        permission: 'reports.view',
      },
      {
        label: 'Cash flow',
        href: '/finance/accounting?view=cash',
        icon: WalletCards,
        permission: 'reports.view',
      },
    ],
  },
  {
    label: 'Team',
    items: [
      {
        label: 'Employees',
        href: '/hr/employees',
        icon: IdCard,
        permission: 'employee.view',
      },
      {
        label: 'Attendance',
        href: '/hr/attendance',
        icon: CalendarCheck,
        permission: 'attendance.view',
      },
      {
        label: 'Leave',
        href: '/hr/leave',
        icon: CalendarOff,
        permission: 'leave.view',
      },
      {
        label: 'Payroll',
        href: '/hr/payroll',
        icon: Banknote,
        permission: 'payroll.view',
      },
    ],
  },
  {
    label: 'More',
    items: [
      { label: 'Letterhead', href: '/letterhead', icon: ScrollText },
      { label: 'Reports', href: '/reports', icon: BarChart3 },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view' },
      {
        label: 'Users & roles',
        href: '/settings/users',
        icon: ShieldCheck,
        permission: 'user.view',
      },
      { label: 'Audit log', href: '/settings/audit', icon: History, permission: 'audit.view' },
    ],
  },
];

/*
 * Menus the workshop can switch off in Settings. Hiding is display only:
 * a hidden page still opens from a link, and permissions still decide who
 * may use it.
 */

/** Always shown, so the workshop can never hide its way out of the app. */
export const ALWAYS_SHOWN_MENUS = ['/', '/job-cards', '/settings'];

/** Menus that only serve the standard job card's steps — hidden with the minimal one. */
export const STANDARD_JOB_CARD_MENUS = ['/inspections', '/approvals'];

export function isMenuShown(
  href: string,
  preferences: { hiddenMenus: string[]; detailedJobCards: boolean },
): boolean {
  if (ALWAYS_SHOWN_MENUS.includes(href)) return true;
  if (!preferences.detailedJobCards && STANDARD_JOB_CARD_MENUS.includes(href)) return false;
  return !preferences.hiddenMenus.includes(href);
}

/** Every menu a workshop may hide. */
export function hideableMenuHrefs(): string[] {
  return NAV_GROUPS.flatMap((group) => group.items)
    .map((item) => item.href)
    .filter((href) => !ALWAYS_SHOWN_MENUS.includes(href));
}

/**
 * The menu item for the page being shown: the most specific match. A link
 * with a query (a tab of the accounting page) matches only on that tab; a
 * plain link matches its path and everything under it, and the longest
 * wins — so "Opening balances" is current on its page, not "Financial
 * overview" at /finance.
 */
export function activeNavHref(
  pathname: string,
  searchParams: { get(name: string): string | null },
  hrefs: string[],
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const href of hrefs) {
    const [path, query] = href.split('?');
    let score = -1;
    if (query) {
      const wanted = new URLSearchParams(query);
      const matches =
        pathname === path &&
        [...wanted.entries()].every(([key, value]) => searchParams.get(key) === value);
      if (matches) score = path.length + 1000;
    } else if (
      path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
    ) {
      score = path.length;
    }
    if (score > bestScore) {
      best = href;
      bestScore = score;
    }
  }
  return best;
}
