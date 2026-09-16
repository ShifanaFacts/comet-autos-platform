export interface NavItem {
  label: string;
  href: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

// Structure matches section 28 of the V1 build instruction. Only Dashboard,
// Check-In, Job Cards, Customers and Vehicles have real implementations in
// this phase — everything else renders a "not yet built" placeholder (see
// components/shell/coming-soon.tsx) rather than a 404, so navigation stays
// honest about what exists without faking data. See PROJECT-STATUS.md for
// the module-by-module roadmap.
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ label: 'Dashboard', href: '/' }] },
  {
    label: 'Workshop',
    items: [
      { label: 'Appointments', href: '/appointments' },
      { label: 'Check-In', href: '/check-in' },
      { label: 'Job Cards', href: '/job-cards' },
      { label: 'Inspections', href: '/inspections' },
      { label: 'Estimates', href: '/estimates' },
      { label: 'Approvals', href: '/approvals' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { label: 'Customers', href: '/customers' },
      { label: 'Vehicles', href: '/vehicles' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Parts', href: '/inventory/parts' },
      { label: 'Suppliers', href: '/inventory/suppliers' },
      { label: 'Purchases', href: '/inventory/purchases' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Invoices', href: '/finance/invoices' },
      { label: 'Payments', href: '/finance/payments' },
      { label: 'Expenses', href: '/finance/expenses' },
      { label: 'Accounting', href: '/finance/accounting' },
      { label: 'VAT', href: '/finance/vat' },
    ],
  },
  {
    label: 'HR',
    items: [
      { label: 'Employees', href: '/hr/employees' },
      { label: 'Attendance', href: '/hr/attendance' },
      { label: 'Leave', href: '/hr/leave' },
      { label: 'Payroll', href: '/hr/payroll' },
    ],
  },
  {
    label: null,
    items: [
      { label: 'Reports', href: '/reports' },
      { label: 'Settings', href: '/settings' },
    ],
  },
];
