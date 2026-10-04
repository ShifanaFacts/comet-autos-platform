/*
 * The permission catalogue: one place naming every code the system enforces,
 * laid out as modules × actions so a role reads as a grid.
 *
 * Every code is `<module>.<action>`. The six actions mean the same thing in
 * every module:
 *
 *   view     open the lists, records and documents
 *   create   add a new record
 *   edit     change a record
 *   delete   delete, void, cancel, reverse or remove one
 *   approve  sign something off (leave, payroll, a customer's approval,
 *            receiving a delivery, adjusting stock, closing the books)
 *   export   download a list as a spreadsheet
 *
 * A module only carries the actions that exist for it — a VAT return has no
 * "delete", a receipt has no "approve". The grid shows an empty cell there.
 *
 * This is a description of the catalogue, not a second authorization system.
 * Enforcement stays where it was — `requirePermission` against the codes a
 * session resolved from the database. The seed and `npm run db:permissions`
 * write these rows; nothing here grants anything.
 */

export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'export',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
  export: 'Export',
};

export interface PermissionModule {
  /** The `module` column on Permission — the prefix of every code in it. */
  key: string;
  label: string;
  /** One line: what the module is, in terms of the screens people use. */
  description: string;
  /** Which of the six actions exist here, and what each one lets a person do. */
  actions: Partial<Record<PermissionAction, string>>;
}

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    key: 'job_card',
    label: 'Job cards',
    description: 'Check-in, inspection, diagnosis, repair, quality check, photos and handover.',
    actions: {
      view: 'Open job cards, inspections, the repair screen and photos.',
      create: 'Check a vehicle in and open a job card; import job cards.',
      edit: 'Record inspection, diagnosis, repair, labour, parts used, quality checks and photos.',
      delete: 'Delete a job card or remove a photo.',
      approve: 'Assign technicians, and hand a finished vehicle back to the customer.',
      export: 'Download the job card list as a spreadsheet.',
    },
  },
  {
    key: 'quotation',
    label: 'Quotations',
    description: 'Quotations, estimates and extra work found during a job.',
    actions: {
      view: 'Open quotations and estimates.',
      create: 'Write a quotation or estimate; import quotations.',
      edit: 'Change, revise, duplicate, send and share a quotation.',
      delete: 'Delete a draft quotation.',
      approve: 'Record the customer’s approval or rejection.',
      export: 'Download the quotation list as a spreadsheet.',
    },
  },
  {
    key: 'appointment',
    label: 'Appointments',
    description: 'The appointment board and bookings.',
    actions: {
      view: 'See the appointment board.',
      create: 'Book an appointment.',
      edit: 'Confirm, reschedule, or mark a no-show.',
      delete: 'Cancel an appointment.',
    },
  },
  {
    key: 'customer',
    label: 'Customers',
    description: 'The customer directory.',
    actions: {
      view: 'Browse and search customers.',
      create: 'Add a customer, including during check-in; import customers.',
      edit: 'Change a customer’s details.',
      delete: 'Delete or restore a customer, and merge duplicates.',
      export: 'Download the customer list as a spreadsheet.',
    },
  },
  {
    key: 'vehicle',
    label: 'Vehicles',
    description: 'The vehicle directory and ownership transfers.',
    actions: {
      view: 'Browse vehicles and their service history.',
      create: 'Register a vehicle, including during check-in; import vehicles.',
      edit: 'Change details, and transfer a vehicle to a new owner.',
      delete: 'Delete or restore a vehicle.',
      export: 'Download the vehicle list as a spreadsheet.',
    },
  },
  {
    key: 'inventory',
    label: 'Parts & stock',
    description: 'Parts, suppliers, stock levels and stock movements.',
    actions: {
      view: 'Parts, suppliers, stock levels and movements.',
      create: 'Add and change parts, prices and suppliers; import them.',
      edit: 'Issue parts to a job and take them back (on the repair screen).',
      delete: 'Delete a part or a supplier.',
      approve: 'Adjust a stock level, with a reason, and reverse a stock movement.',
      export: 'Download parts, suppliers and stock movements as spreadsheets.',
    },
  },
  {
    key: 'purchase',
    label: 'Purchases',
    description: 'Buying parts from suppliers.',
    actions: {
      view: 'Open purchases and deliveries.',
      create: 'Raise a purchase.',
      edit: 'Change a purchase that hasn’t been received.',
      delete: 'Cancel or delete a purchase.',
      approve: 'Receive a delivery into stock.',
      export: 'Download the purchase list as a spreadsheet.',
    },
  },
  {
    key: 'supplier_payment',
    label: 'Supplier payments',
    description: 'What the workshop owes suppliers, and paying them.',
    actions: {
      view: 'Payables, supplier balances and statements, and payments made.',
      create: 'Pay a supplier.',
      delete: 'Reverse a supplier payment.',
    },
  },
  {
    key: 'invoice',
    label: 'Sales invoices',
    description: 'Customer invoices, receivables and customer statements.',
    actions: {
      view: 'Invoices, receivables, customer statements and the financial overview.',
      create: 'Issue an invoice; import invoices.',
      edit: 'Correct an issued invoice.',
      delete: 'Void an invoice.',
      export: 'Download the invoice list as a spreadsheet.',
    },
  },
  {
    key: 'payment',
    label: 'Receipts',
    description: 'Money received from customers.',
    actions: {
      view: 'Receipts and payments received.',
      create: 'Take a payment against an invoice.',
      delete: 'Reverse a receipt, or pay out a credit note’s refund.',
      export: 'Download the receipt list as a spreadsheet.',
    },
  },
  {
    key: 'credit_note',
    label: 'Credit notes',
    description: 'Credits issued against invoices.',
    actions: {
      view: 'Open credit notes.',
      create: 'Issue a credit note against an invoice.',
      delete: 'Void a credit note.',
    },
  },
  {
    key: 'expense',
    label: 'Expenses',
    description: 'Workshop expenses and the supplier bills behind them.',
    actions: {
      view: 'Expenses and their attached bills.',
      create: 'Record an expense and attach its bill.',
      edit: 'Change an expense, or remove an attached bill.',
      delete: 'Void an expense.',
    },
  },
  {
    key: 'accounting',
    label: 'Accounts & ledger',
    description:
      'Chart of accounts, journal, general ledger, opening balances, year-end, bank reconciliation and fixed assets.',
    actions: {
      view: 'The chart of accounts, journal, ledger, opening balances, year-end, bank reconciliation and fixed assets.',
      create:
        'Post a manual journal entry; add accounts and fixed assets; start a bank reconciliation.',
      edit: 'Change accounts and opening balances; tick off bank lines; run depreciation.',
      delete:
        'Reverse a journal entry; dispose of or delete a fixed asset; discard a reconciliation.',
      approve:
        'Close and reopen the books and the financial year; complete a bank reconciliation; book existing records.',
    },
  },
  {
    key: 'money',
    label: 'Money',
    description:
      'Cash on hand, petty cash, bank and card accounts: what is in each, and moving money between them.',
    actions: {
      view: 'See how much is in each cash, bank and card account, and every movement in and out.',
      create: 'Move money between the workshop’s own accounts, e.g. cash on hand into petty cash.',
      delete: 'Void a money transfer entered by mistake.',
    },
  },
  {
    key: 'customer_advance',
    label: 'Customer advances',
    description: 'Money customers pay before their invoice, applied to invoices later.',
    actions: {
      view: 'See customer advances, what is left of each and where it was applied.',
      create: 'Receive an advance from a customer.',
      edit: 'Apply an advance to an invoice, or undo an application.',
      delete: 'Refund an advance to the customer, reverse a refund, or cancel an advance.',
    },
  },
  {
    key: 'vat',
    label: 'VAT returns',
    description: 'The VAT return and filings.',
    actions: {
      view: 'The VAT return and past filings.',
      create: 'File a return and record its payment.',
    },
  },
  {
    key: 'reports',
    label: 'Financial statements & reports',
    description:
      'Profit & loss, balance sheet, cash flow and trial balance. The workshop report shows each area to whoever can view it.',
    actions: {
      view: 'Profit & loss, balance sheet, cash flow and trial balance.',
      export: 'Download the financial statements as spreadsheets.',
    },
  },
  {
    key: 'employee',
    label: 'Employees',
    description: 'Employee records.',
    actions: {
      view: 'The team list and employee records.',
      create: 'Add an employee.',
      edit: 'Change an employee’s record.',
    },
  },
  {
    key: 'attendance',
    label: 'Attendance',
    description: 'Clocking in and out, and daily attendance.',
    actions: {
      view: 'Daily attendance and each person’s record.',
      create: 'Clock someone in or out.',
      edit: 'Mark or correct a day’s attendance, and review missed check-outs.',
    },
  },
  {
    key: 'task',
    label: 'Tasks',
    description:
      'Work given to the team. Everyone keeps their own to-do list without any of these.',
    actions: {
      view: 'See every employee’s tasks and the team board.',
      create: 'Give tasks to employees.',
      edit: 'Change any task — its wording, due date, priority or who it is for.',
      delete: 'Cancel any task.',
    },
  },
  {
    key: 'leave',
    label: 'Leave',
    description: 'Leave requests and approvals.',
    actions: {
      view: 'Leave requests and balances.',
      create: 'Record a leave request.',
      delete: 'Cancel leave.',
      approve: 'Approve or reject leave.',
    },
  },
  {
    key: 'payroll',
    label: 'Payroll',
    description: 'Salaries and monthly payroll runs.',
    actions: {
      view: 'Salaries and payroll runs.',
      create: 'Set salaries and run payroll.',
      edit: 'Recalculate a run and adjust deductions.',
      delete: 'Cancel a payroll run.',
      approve: 'Approve a run and record it as paid.',
    },
  },
  {
    key: 'settings',
    label: 'Workshop settings',
    description: 'Workshop details, branches, letterhead, tax codes, payment modes and menus.',
    actions: {
      view: 'The settings screens, tax codes and payment modes.',
      create: 'Add tax codes and payment modes.',
      edit: 'Change workshop details, VAT and tax codes, payment modes, letterhead and menus.',
    },
  },
  {
    key: 'user',
    label: 'Users',
    description: 'Who can sign in.',
    actions: {
      view: 'The user list and each user’s roles.',
      create: 'Create a login.',
      edit: 'Change a user’s details and roles; reset a password.',
      delete: 'Deactivate or reactivate an account.',
    },
  },
  {
    key: 'role',
    label: 'Roles',
    description: 'What each role is allowed to do.',
    actions: {
      view: 'See each role and what it allows.',
      create: 'Create a role.',
      edit: 'Change which permissions a role carries.',
    },
  },
  {
    key: 'audit',
    label: 'Audit log',
    description: 'Who did what, and when.',
    actions: {
      view: 'Read the audit log.',
      export: 'Download the audit log as a spreadsheet.',
    },
  },
];

export function permissionCode(module: string, action: PermissionAction) {
  return `${module}.${action}`;
}

/** Every code the system knows about, in catalogue order. */
export const PERMISSION_CODES = PERMISSION_MODULES.flatMap((module) =>
  PERMISSION_ACTIONS.filter((action) => module.actions[action]).map((action) =>
    permissionCode(module.key, action),
  ),
);

const DETAILS = new Map(
  PERMISSION_MODULES.flatMap((module) =>
    PERMISSION_ACTIONS.filter((action) => module.actions[action]).map(
      (action) => [permissionCode(module.key, action), module.actions[action]!] as const,
    ),
  ),
);

const MODULE_LABELS = new Map(PERMISSION_MODULES.map((module) => [module.key, module.label]));

/** "Customers · Edit" — a code's human label, falling back to the code itself. */
export function permissionLabel(code: string) {
  const [module, action] = code.split('.');
  const label = MODULE_LABELS.get(module);
  if (!label || !DETAILS.has(code)) return code;
  return `${label} · ${ACTION_LABELS[action as PermissionAction]}`;
}

/** What a code lets a person do, in a sentence. */
export function permissionDetail(code: string) {
  return DETAILS.get(code) ?? null;
}

/**
 * Starting points for a new role. The admin adjusts the ticks after choosing
 * one; nothing ties a role to the preset it began from.
 */
export interface RolePreset {
  key: string;
  label: string;
  description: string;
  codes: string[];
}

const every = (action: PermissionAction) =>
  PERMISSION_CODES.filter((code) => code.endsWith(`.${action}`));
const all = (...modules: string[]) =>
  PERMISSION_CODES.filter((code) => modules.includes(code.split('.')[0]));
const only = (...codes: string[]) => codes.filter((code) => PERMISSION_CODES.includes(code));

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'owner',
    label: 'Owner-like',
    description: 'Everything, including users, roles and the audit log.',
    codes: [...PERMISSION_CODES],
  },
  {
    key: 'manager',
    label: 'Manager',
    description: 'Runs the workshop day to day: everything except users, roles and the audit log.',
    codes: PERMISSION_CODES.filter(
      (code) => !['user', 'role', 'audit'].includes(code.split('.')[0]),
    ).concat(only('user.view', 'role.view')),
  },
  {
    key: 'accountant',
    label: 'Accountant',
    description: 'The books: invoices, receipts, expenses, payables, VAT, payroll and reports.',
    codes: [
      ...every('view').filter((code) => !['user.view', 'role.view'].includes(code)),
      ...all(
        'invoice',
        'payment',
        'credit_note',
        'expense',
        'supplier_payment',
        'accounting',
        'vat',
        'reports',
        'payroll',
      ),
      ...only('purchase.export', 'inventory.export', 'customer.export', 'settings.edit'),
    ],
  },
  {
    key: 'front_desk',
    label: 'Front desk',
    description: 'Check-in, customers, appointments, quotations, invoices and taking payments.',
    codes: [
      ...all('customer', 'vehicle', 'appointment').filter((code) => !code.endsWith('.delete')),
      ...only(
        'job_card.view',
        'job_card.create',
        'job_card.approve',
        'quotation.view',
        'quotation.create',
        'quotation.edit',
        'quotation.approve',
        'invoice.view',
        'invoice.create',
        'payment.view',
        'payment.create',
        'credit_note.view',
        'inventory.view',
      ),
    ],
  },
  {
    key: 'supervisor',
    label: 'Supervisor',
    description:
      'Runs the floor: works on jobs, assigns technicians, gives and follows up tasks, and sees attendance.',
    codes: [
      ...all('task', 'appointment').filter((code) => code !== 'appointment.delete'),
      ...only(
        'job_card.view',
        'job_card.create',
        'job_card.edit',
        'job_card.approve',
        'quotation.view',
        'customer.view',
        'customer.create',
        'vehicle.view',
        'vehicle.create',
        'inventory.view',
        'inventory.edit',
        'employee.view',
        'attendance.view',
        'leave.view',
      ),
    ],
  },
  {
    key: 'technician',
    label: 'Technician',
    description:
      'Works on jobs: inspection, diagnosis, repair, parts used and photos. Checks in and keeps a to-do list.',
    codes: only(
      'job_card.view',
      'job_card.edit',
      'quotation.view',
      'customer.view',
      'vehicle.view',
      'inventory.view',
      'inventory.edit',
      'appointment.view',
    ),
  },
  {
    key: 'partner',
    label: 'Partner (view only)',
    description:
      'Sees everything, changes nothing: every View, the report downloads and the audit log.',
    codes: [...every('view'), ...only('reports.export', 'audit.view')],
  },
].map((preset) => ({ ...preset, codes: [...new Set(preset.codes)] }));
