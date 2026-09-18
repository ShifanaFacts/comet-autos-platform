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
  Receipt,
  Wallet,
  ReceiptText,
  Calculator,
  Percent,
  IdCard,
  CalendarCheck,
  CalendarOff,
  Banknote,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

// Structure matches section 4/28 of the build instructions. Only Dashboard,
// Check-In, Job Cards, Customers and Vehicles have real implementations in
// this phase — everything else renders a "not built yet" placeholder (see
// components/shell/coming-soon.tsx) rather than a 404, so navigation stays
// honest about what exists without faking data. See PROJECT-STATUS.md for
// the module-by-module roadmap.
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ label: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  {
    label: 'Workshop',
    items: [
      { label: 'Appointments', href: '/appointments', icon: CalendarDays },
      { label: 'Check-In', href: '/check-in', icon: LogIn },
      { label: 'Job Cards', href: '/job-cards', icon: ClipboardList },
      { label: 'Inspections', href: '/inspections', icon: ClipboardCheck },
      { label: 'Estimates', href: '/estimates', icon: FileText },
      { label: 'Approvals', href: '/approvals', icon: BadgeCheck },
    ],
  },
  {
    label: 'Customers',
    items: [
      { label: 'Customers', href: '/customers', icon: Users },
      { label: 'Vehicles', href: '/vehicles', icon: Car },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Parts', href: '/inventory/parts', icon: Cog },
      { label: 'Suppliers', href: '/inventory/suppliers', icon: Truck },
      { label: 'Purchases', href: '/inventory/purchases', icon: ShoppingCart },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Invoices', href: '/finance/invoices', icon: Receipt },
      { label: 'Payments', href: '/finance/payments', icon: Wallet },
      { label: 'Expenses', href: '/finance/expenses', icon: ReceiptText },
      { label: 'Accounting', href: '/finance/accounting', icon: Calculator },
      { label: 'VAT', href: '/finance/vat', icon: Percent },
    ],
  },
  {
    label: 'HR',
    items: [
      { label: 'Employees', href: '/hr/employees', icon: IdCard },
      { label: 'Attendance', href: '/hr/attendance', icon: CalendarCheck },
      { label: 'Leave', href: '/hr/leave', icon: CalendarOff },
      { label: 'Payroll', href: '/hr/payroll', icon: Banknote },
    ],
  },
  {
    label: null,
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart3 },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];
