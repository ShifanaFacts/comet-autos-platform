-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('PRIMARY', 'SUPPORT');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InspectionItemResult" AS ENUM ('OK', 'ATTENTION_NEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EstimateItemType" AS ENUM ('PART', 'LABOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalMethod" AS ENUM ('IN_PERSON', 'PHONE', 'EMAIL', 'SMS', 'DIGITAL_SIGNATURE');

-- CreateEnum
CREATE TYPE "ApprovalItemDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobCardStatus" AS ENUM ('RECEIVED', 'INSPECTING', 'DIAGNOSED', 'ESTIMATE_SENT', 'APPROVED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('PURCHASE_RECEIPT', 'JOB_CONSUMPTION', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN_TO_SUPPLIER', 'CUSTOMER_RETURN');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('TAX_INVOICE', 'PROFORMA');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('RECORDED', 'VOID');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('JOB_CARD', 'ESTIMATE', 'TAX_INVOICE', 'PROFORMA_INVOICE', 'PURCHASE_ORDER', 'PAYMENT_RECEIPT', 'EXPENSE_VOUCHER', 'SUPPLIER_PAYMENT');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('PHOTO', 'INVOICE_PDF', 'INSPECTION_REPORT', 'EMPLOYEE_DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_number" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "base_currency" TEXT NOT NULL DEFAULT 'AED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "primary_branch_id" UUID,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "branch_id" UUID,
    "assigned_by_user_id" UUID,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by_user_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "tax_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "plate_number" TEXT NOT NULL,
    "plate_emirate" TEXT,
    "vin" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "last_mileage" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "estimated_duration_minutes" INTEGER,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_cards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "appointment_id" UUID,
    "job_number" TEXT NOT NULL,
    "status" "JobCardStatus" NOT NULL DEFAULT 'RECEIVED',
    "odometer_reading" INTEGER,
    "customer_complaint" TEXT,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_status_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "from_status" "JobCardStatus",
    "to_status" "JobCardStatus" NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "assignment_role" "AssignmentRole" NOT NULL DEFAULT 'SUPPORT',
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ,

    CONSTRAINT "job_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "inspected_by_employee_id" UUID NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "summary" TEXT,
    "inspected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "result" "InspectionItemResult" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "inspection_id" UUID,
    "diagnosed_by_employee_id" UUID NOT NULL,
    "findings" TEXT NOT NULL,
    "recommended_action" TEXT,
    "diagnosed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "previous_version_id" UUID,
    "estimate_number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "prepared_by_user_id" UUID NOT NULL,
    "sent_by_user_id" UUID,
    "valid_until" DATE,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "item_type" "EstimateItemType" NOT NULL,
    "part_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "tax_rate" DECIMAL(5,2),
    "tax_amount" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "estimate_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "approval_method" "ApprovalMethod" NOT NULL,
    "approved_at" TIMESTAMPTZ,
    "recorded_by_user_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "approval_id" UUID NOT NULL,
    "estimate_item_id" UUID NOT NULL,
    "decision" "ApprovalItemDecision" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "approval_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labours" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "performed_by_employee_id" UUID NOT NULL,
    "work_record_id" UUID,
    "description" TEXT NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "labours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_usages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "used_by_employee_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "part_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "work_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit_of_measure" TEXT NOT NULL,
    "default_cost_price" DECIMAL(14,2),
    "default_selling_price" DECIMAL(14,2),
    "default_tax_rate" DECIMAL(5,2),
    "preferred_supplier_id" UUID,
    "reorder_level" DECIMAL(12,3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_number" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(14,2),
    "tax_amount" DECIMAL(14,2) DEFAULT 0,
    "total_amount" DECIMAL(14,2),
    "ordered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "received_by_user_id" UUID,
    "journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "quantity_ordered" DECIMAL(12,3) NOT NULL,
    "quantity_received" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "tax_rate" DECIMAL(5,2),
    "tax_amount" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "transaction_type" "InventoryTransactionType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "purchase_item_id" UUID,
    "part_usage_id" UUID,
    "performed_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "job_card_id" UUID,
    "customer_id" UUID NOT NULL,
    "invoice_type" "InvoiceType" NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE NOT NULL,
    "supply_date" DATE,
    "due_date" DATE,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "seller_legal_name" TEXT,
    "seller_tax_number" TEXT,
    "seller_address" TEXT,
    "customer_name" TEXT,
    "customer_tax_number" TEXT,
    "customer_address" TEXT,
    "journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "issued_by_user_id" UUID,
    "issued_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "tax_rate" DECIMAL(5,2),
    "tax_amount" DECIMAL(14,2),
    "part_usage_id" UUID,
    "labour_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "payment_number" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "reference_number" TEXT,
    "reversal_of_payment_id" UUID,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by_user_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "supplier_payment_number" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "reference_number" TEXT,
    "reversal_of_supplier_payment_id" UUID,
    "paid_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by_user_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "chart_of_account_id" UUID,
    "expense_number" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'RECORDED',
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax_rate" DECIMAL(5,2),
    "tax_amount" DECIMAL(14,2),
    "expense_date" DATE NOT NULL,
    "vendor_name" TEXT,
    "payment_method" "PaymentMethod",
    "recorded_by_user_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "parent_account_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "entry_date" DATE NOT NULL,
    "description" TEXT,
    "is_posted" BOOLEAN NOT NULL DEFAULT false,
    "posted_at" TIMESTAMPTZ,
    "posted_by_user_id" UUID,
    "reversal_of_journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "chart_of_account_id" UUID NOT NULL,
    "debit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "job_title" TEXT,
    "department" TEXT,
    "hire_date" DATE NOT NULL,
    "termination_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "clock_in_at" TIMESTAMPTZ,
    "clock_out_at" TIMESTAMPTZ,
    "status" "AttendanceStatus" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type" "LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salaries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "basic_salary" DECIMAL(14,2) NOT NULL,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "calculated_at" TIMESTAMPTZ,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "paid_by_user_id" UUID,
    "paid_at" TIMESTAMPTZ,
    "journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payroll_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "basic_salary" DECIMAL(14,2) NOT NULL,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_number_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "document_type" "DocumentType" NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "padding" INTEGER NOT NULL DEFAULT 6,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "allow_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "document_type" "DocumentCategory" NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_organization_id_idx" ON "branches"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_id_key" ON "branches"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_organization_id_primary_branch_id_idx" ON "users"("organization_id", "primary_branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_id_key" ON "users"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_email_key" ON "users"("organization_id", "email");

-- CreateIndex
CREATE INDEX "roles_organization_id_idx" ON "roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_id_key" ON "roles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_name_key" ON "roles"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "user_roles_organization_id_idx" ON "user_roles"("organization_id");

-- CreateIndex
CREATE INDEX "user_roles_organization_id_role_id_idx" ON "user_roles"("organization_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_branch_scoped_unique" ON "user_roles"("user_id", "role_id", "branch_id") WHERE (revoked_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_orgwide_unique" ON "user_roles"("user_id", "role_id") WHERE (branch_id IS NULL AND revoked_at IS NULL);

-- CreateIndex
CREATE INDEX "role_permissions_organization_id_idx" ON "role_permissions"("organization_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_idx" ON "customers"("organization_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_name_idx" ON "customers"("organization_id", "name");

-- CreateIndex
CREATE INDEX "customers_organization_id_phone_idx" ON "customers"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_id_key" ON "customers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_idx" ON "vehicles"("organization_id");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_customer_id_idx" ON "vehicles"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_id_key" ON "vehicles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_plate_number_key" ON "vehicles"("organization_id", "plate_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_vin_key" ON "vehicles"("organization_id", "vin");

-- CreateIndex
CREATE INDEX "appointments_organization_id_idx" ON "appointments"("organization_id");

-- CreateIndex
CREATE INDEX "appointments_organization_id_branch_id_scheduled_at_idx" ON "appointments"("organization_id", "branch_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_organization_id_customer_id_idx" ON "appointments"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "appointments_organization_id_vehicle_id_idx" ON "appointments"("organization_id", "vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_organization_id_id_key" ON "appointments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "job_cards_organization_id_idx" ON "job_cards"("organization_id");

-- CreateIndex
CREATE INDEX "job_cards_organization_id_branch_id_idx" ON "job_cards"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "job_cards_organization_id_vehicle_id_idx" ON "job_cards"("organization_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "job_cards_organization_id_status_idx" ON "job_cards"("organization_id", "status");

-- CreateIndex
CREATE INDEX "job_cards_organization_id_branch_id_status_idx" ON "job_cards"("organization_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_cards_organization_id_id_key" ON "job_cards"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_cards_organization_id_job_number_key" ON "job_cards"("organization_id", "job_number");

-- CreateIndex
CREATE INDEX "job_status_history_organization_id_idx" ON "job_status_history"("organization_id");

-- CreateIndex
CREATE INDEX "job_status_history_organization_id_job_card_id_changed_at_idx" ON "job_status_history"("organization_id", "job_card_id", "changed_at");

-- CreateIndex
CREATE INDEX "job_assignments_organization_id_idx" ON "job_assignments"("organization_id");

-- CreateIndex
CREATE INDEX "job_assignments_organization_id_job_card_id_idx" ON "job_assignments"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "job_assignments_organization_id_employee_id_idx" ON "job_assignments"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_active_primary_assignment_per_job_card" ON "job_assignments"("job_card_id") WHERE (assignment_role = 'PRIMARY' AND unassigned_at IS NULL);

-- CreateIndex
CREATE INDEX "inspections_organization_id_idx" ON "inspections"("organization_id");

-- CreateIndex
CREATE INDEX "inspections_organization_id_job_card_id_idx" ON "inspections"("organization_id", "job_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_organization_id_id_key" ON "inspections"("organization_id", "id");

-- CreateIndex
CREATE INDEX "inspection_items_organization_id_idx" ON "inspection_items"("organization_id");

-- CreateIndex
CREATE INDEX "inspection_items_organization_id_inspection_id_idx" ON "inspection_items"("organization_id", "inspection_id");

-- CreateIndex
CREATE INDEX "diagnoses_organization_id_idx" ON "diagnoses"("organization_id");

-- CreateIndex
CREATE INDEX "diagnoses_organization_id_job_card_id_idx" ON "diagnoses"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "estimates_organization_id_idx" ON "estimates"("organization_id");

-- CreateIndex
CREATE INDEX "estimates_organization_id_job_card_id_idx" ON "estimates"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "estimates_organization_id_previous_version_id_idx" ON "estimates"("organization_id", "previous_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_organization_id_id_key" ON "estimates"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_organization_id_estimate_number_key" ON "estimates"("organization_id", "estimate_number");

-- CreateIndex
CREATE INDEX "estimate_items_organization_id_idx" ON "estimate_items"("organization_id");

-- CreateIndex
CREATE INDEX "estimate_items_organization_id_estimate_id_idx" ON "estimate_items"("organization_id", "estimate_id");

-- CreateIndex
CREATE INDEX "estimate_items_organization_id_part_id_idx" ON "estimate_items"("organization_id", "part_id");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_items_organization_id_id_key" ON "estimate_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "approvals_organization_id_idx" ON "approvals"("organization_id");

-- CreateIndex
CREATE INDEX "approvals_organization_id_estimate_id_idx" ON "approvals"("organization_id", "estimate_id");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_organization_id_id_key" ON "approvals"("organization_id", "id");

-- CreateIndex
CREATE INDEX "approval_items_organization_id_idx" ON "approval_items"("organization_id");

-- CreateIndex
CREATE INDEX "approval_items_organization_id_estimate_item_id_idx" ON "approval_items"("organization_id", "estimate_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_items_approval_id_estimate_item_id_key" ON "approval_items"("approval_id", "estimate_item_id");

-- CreateIndex
CREATE INDEX "labours_organization_id_idx" ON "labours"("organization_id");

-- CreateIndex
CREATE INDEX "labours_organization_id_job_card_id_idx" ON "labours"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "labours_organization_id_performed_by_employee_id_idx" ON "labours"("organization_id", "performed_by_employee_id");

-- CreateIndex
CREATE INDEX "labours_organization_id_work_record_id_idx" ON "labours"("organization_id", "work_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "labours_organization_id_id_key" ON "labours"("organization_id", "id");

-- CreateIndex
CREATE INDEX "part_usages_organization_id_idx" ON "part_usages"("organization_id");

-- CreateIndex
CREATE INDEX "part_usages_organization_id_job_card_id_idx" ON "part_usages"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "part_usages_organization_id_part_id_idx" ON "part_usages"("organization_id", "part_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_usages_organization_id_id_key" ON "part_usages"("organization_id", "id");

-- CreateIndex
CREATE INDEX "work_records_organization_id_idx" ON "work_records"("organization_id");

-- CreateIndex
CREATE INDEX "work_records_organization_id_job_card_id_idx" ON "work_records"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "work_records_organization_id_employee_id_idx" ON "work_records"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_records_organization_id_id_key" ON "work_records"("organization_id", "id");

-- CreateIndex
CREATE INDEX "parts_organization_id_idx" ON "parts"("organization_id");

-- CreateIndex
CREATE INDEX "parts_organization_id_preferred_supplier_id_idx" ON "parts"("organization_id", "preferred_supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_id_key" ON "parts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_sku_key" ON "parts"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "suppliers_organization_id_idx" ON "suppliers"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_id_key" ON "suppliers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "purchases_organization_id_idx" ON "purchases"("organization_id");

-- CreateIndex
CREATE INDEX "purchases_organization_id_branch_id_idx" ON "purchases"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "purchases_organization_id_supplier_id_idx" ON "purchases"("organization_id", "supplier_id");

-- CreateIndex
CREATE INDEX "purchases_organization_id_status_idx" ON "purchases"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_organization_id_id_key" ON "purchases"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_organization_id_purchase_number_key" ON "purchases"("organization_id", "purchase_number");

-- CreateIndex
CREATE INDEX "purchase_items_organization_id_idx" ON "purchase_items"("organization_id");

-- CreateIndex
CREATE INDEX "purchase_items_organization_id_purchase_id_idx" ON "purchase_items"("organization_id", "purchase_id");

-- CreateIndex
CREATE INDEX "purchase_items_organization_id_part_id_idx" ON "purchase_items"("organization_id", "part_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_organization_id_id_key" ON "purchase_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "inventory_transactions_organization_id_idx" ON "inventory_transactions"("organization_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_organization_id_branch_id_part_id_idx" ON "inventory_transactions"("organization_id", "branch_id", "part_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_organization_id_part_id_idx" ON "inventory_transactions"("organization_id", "part_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_created_at_idx" ON "inventory_transactions"("created_at");

-- CreateIndex
CREATE INDEX "invoices_organization_id_idx" ON "invoices"("organization_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_branch_id_idx" ON "invoices"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_job_card_id_idx" ON "invoices"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_customer_id_idx" ON "invoices"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_status_idx" ON "invoices"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_id_key" ON "invoices"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_invoice_number_key" ON "invoices"("organization_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_items_organization_id_idx" ON "invoice_items"("organization_id");

-- CreateIndex
CREATE INDEX "invoice_items_organization_id_invoice_id_idx" ON "invoice_items"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_idx" ON "payments"("organization_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_invoice_id_idx" ON "payments"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_received_at_idx" ON "payments"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_id_key" ON "payments"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_payment_number_key" ON "payments"("organization_id", "payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reversal_of_payment_id_key" ON "payments"("reversal_of_payment_id");

-- CreateIndex
CREATE INDEX "supplier_payments_organization_id_idx" ON "supplier_payments"("organization_id");

-- CreateIndex
CREATE INDEX "supplier_payments_organization_id_purchase_id_idx" ON "supplier_payments"("organization_id", "purchase_id");

-- CreateIndex
CREATE INDEX "supplier_payments_paid_at_idx" ON "supplier_payments"("paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_organization_id_id_key" ON "supplier_payments"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_organization_id_supplier_payment_number_key" ON "supplier_payments"("organization_id", "supplier_payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_reversal_of_supplier_payment_id_key" ON "supplier_payments"("reversal_of_supplier_payment_id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_idx" ON "expenses"("organization_id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_branch_id_idx" ON "expenses"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_organization_id_id_key" ON "expenses"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_organization_id_expense_number_key" ON "expenses"("organization_id", "expense_number");

-- CreateIndex
CREATE INDEX "chart_of_accounts_organization_id_idx" ON "chart_of_accounts"("organization_id");

-- CreateIndex
CREATE INDEX "chart_of_accounts_organization_id_parent_account_id_idx" ON "chart_of_accounts"("organization_id", "parent_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_organization_id_id_key" ON "chart_of_accounts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_organization_id_account_code_key" ON "chart_of_accounts"("organization_id", "account_code");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_idx" ON "journal_entries"("organization_id");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_branch_id_idx" ON "journal_entries"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "journal_entries_entry_date_idx" ON "journal_entries"("entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_id_key" ON "journal_entries"("organization_id", "id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_organization_id_idx" ON "journal_entry_lines"("organization_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_organization_id_journal_entry_id_idx" ON "journal_entry_lines"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_organization_id_chart_of_account_id_idx" ON "journal_entry_lines"("organization_id", "chart_of_account_id");

-- CreateIndex
CREATE INDEX "employees_organization_id_idx" ON "employees"("organization_id");

-- CreateIndex
CREATE INDEX "employees_organization_id_branch_id_idx" ON "employees"("organization_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_id_key" ON "employees"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_employee_code_key" ON "employees"("organization_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_user_id_key" ON "employees"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "attendances_organization_id_idx" ON "attendances"("organization_id");

-- CreateIndex
CREATE INDEX "attendances_organization_id_branch_id_attendance_date_idx" ON "attendances"("organization_id", "branch_id", "attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_employee_id_attendance_date_key" ON "attendances"("employee_id", "attendance_date");

-- CreateIndex
CREATE INDEX "leaves_organization_id_idx" ON "leaves"("organization_id");

-- CreateIndex
CREATE INDEX "leaves_organization_id_employee_id_idx" ON "leaves"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "leaves_organization_id_employee_id_start_date_end_date_idx" ON "leaves"("organization_id", "employee_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "salaries_organization_id_idx" ON "salaries"("organization_id");

-- CreateIndex
CREATE INDEX "salaries_organization_id_employee_id_effective_from_idx" ON "salaries"("organization_id", "employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "payrolls_organization_id_idx" ON "payrolls"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_organization_id_id_key" ON "payrolls"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_organization_id_period_start_period_end_key" ON "payrolls"("organization_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "payroll_items_organization_id_idx" ON "payroll_items"("organization_id");

-- CreateIndex
CREATE INDEX "payroll_items_organization_id_employee_id_idx" ON "payroll_items"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_payroll_id_employee_id_key" ON "payroll_items"("payroll_id", "employee_id");

-- CreateIndex
CREATE INDEX "document_number_sequences_organization_id_idx" ON "document_number_sequences"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "doc_number_seq_branch_scoped_unique" ON "document_number_sequences"("organization_id", "branch_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "doc_number_seq_orgwide_unique" ON "document_number_sequences"("organization_id", "document_type") WHERE (branch_id IS NULL);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_actor_user_id_idx" ON "audit_logs"("organization_id", "actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_organization_id_idx" ON "documents"("organization_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_entity_type_entity_id_idx" ON "documents"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_uploaded_by_user_id_idx" ON "documents"("organization_id", "uploaded_by_user_id");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_primary_branch_id_fkey" FOREIGN KEY ("organization_id", "primary_branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_role_id_fkey" FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_branch_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_assigned_by_user_id_fkey" FOREIGN KEY ("organization_id", "assigned_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_revoked_by_user_id_fkey" FOREIGN KEY ("organization_id", "revoked_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_role_id_fkey" FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_organization_id_appointment_id_fkey" FOREIGN KEY ("organization_id", "appointment_id") REFERENCES "appointments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_organization_id_changed_by_user_id_fkey" FOREIGN KEY ("organization_id", "changed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_organization_id_assigned_by_user_id_fkey" FOREIGN KEY ("organization_id", "assigned_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organization_id_inspected_by_employee_id_fkey" FOREIGN KEY ("organization_id", "inspected_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_organization_id_inspection_id_fkey" FOREIGN KEY ("organization_id", "inspection_id") REFERENCES "inspections"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_organization_id_inspection_id_fkey" FOREIGN KEY ("organization_id", "inspection_id") REFERENCES "inspections"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_organization_id_diagnosed_by_employee_id_fkey" FOREIGN KEY ("organization_id", "diagnosed_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_previous_version_id_fkey" FOREIGN KEY ("organization_id", "previous_version_id") REFERENCES "estimates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_prepared_by_user_id_fkey" FOREIGN KEY ("organization_id", "prepared_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_sent_by_user_id_fkey" FOREIGN KEY ("organization_id", "sent_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_organization_id_estimate_id_fkey" FOREIGN KEY ("organization_id", "estimate_id") REFERENCES "estimates"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_estimate_id_fkey" FOREIGN KEY ("organization_id", "estimate_id") REFERENCES "estimates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_recorded_by_user_id_fkey" FOREIGN KEY ("organization_id", "recorded_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_organization_id_approval_id_fkey" FOREIGN KEY ("organization_id", "approval_id") REFERENCES "approvals"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_organization_id_estimate_item_id_fkey" FOREIGN KEY ("organization_id", "estimate_item_id") REFERENCES "estimate_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labours" ADD CONSTRAINT "labours_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labours" ADD CONSTRAINT "labours_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labours" ADD CONSTRAINT "labours_organization_id_performed_by_employee_id_fkey" FOREIGN KEY ("organization_id", "performed_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labours" ADD CONSTRAINT "labours_organization_id_work_record_id_fkey" FOREIGN KEY ("organization_id", "work_record_id") REFERENCES "work_records"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_usages" ADD CONSTRAINT "part_usages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_usages" ADD CONSTRAINT "part_usages_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_usages" ADD CONSTRAINT "part_usages_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_usages" ADD CONSTRAINT "part_usages_organization_id_used_by_employee_id_fkey" FOREIGN KEY ("organization_id", "used_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_records" ADD CONSTRAINT "work_records_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_organization_id_preferred_supplier_id_fkey" FOREIGN KEY ("organization_id", "preferred_supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_received_by_user_id_fkey" FOREIGN KEY ("organization_id", "received_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_organization_id_purchase_id_fkey" FOREIGN KEY ("organization_id", "purchase_id") REFERENCES "purchases"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_purchase_item_id_fkey" FOREIGN KEY ("organization_id", "purchase_item_id") REFERENCES "purchase_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_part_usage_id_fkey" FOREIGN KEY ("organization_id", "part_usage_id") REFERENCES "part_usages"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_performed_by_user_i_fkey" FOREIGN KEY ("organization_id", "performed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_issued_by_user_id_fkey" FOREIGN KEY ("organization_id", "issued_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_part_usage_id_fkey" FOREIGN KEY ("organization_id", "part_usage_id") REFERENCES "part_usages"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_labour_id_fkey" FOREIGN KEY ("organization_id", "labour_id") REFERENCES "labours"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_reversal_of_payment_id_fkey" FOREIGN KEY ("organization_id", "reversal_of_payment_id") REFERENCES "payments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_received_by_user_id_fkey" FOREIGN KEY ("organization_id", "received_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organization_id_purchase_id_fkey" FOREIGN KEY ("organization_id", "purchase_id") REFERENCES "purchases"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organization_id_reversal_of_supplier_pay_fkey" FOREIGN KEY ("organization_id", "reversal_of_supplier_payment_id") REFERENCES "supplier_payments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organization_id_paid_by_user_id_fkey" FOREIGN KEY ("organization_id", "paid_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_chart_of_account_id_fkey" FOREIGN KEY ("organization_id", "chart_of_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_recorded_by_user_id_fkey" FOREIGN KEY ("organization_id", "recorded_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_parent_account_id_fkey" FOREIGN KEY ("organization_id", "parent_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_reversal_of_journal_entry__fkey" FOREIGN KEY ("organization_id", "reversal_of_journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_posted_by_user_id_fkey" FOREIGN KEY ("organization_id", "posted_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_organization_id_chart_of_account_id_fkey" FOREIGN KEY ("organization_id", "chart_of_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_organization_id_approved_by_user_id_fkey" FOREIGN KEY ("organization_id", "approved_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_organization_id_approved_by_user_id_fkey" FOREIGN KEY ("organization_id", "approved_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_organization_id_paid_by_user_id_fkey" FOREIGN KEY ("organization_id", "paid_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_organization_id_payroll_id_fkey" FOREIGN KEY ("organization_id", "payroll_id") REFERENCES "payrolls"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_number_sequences" ADD CONSTRAINT "document_number_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_number_sequences" ADD CONSTRAINT "document_number_sequences_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_actor_user_id_fkey" FOREIGN KEY ("organization_id", "actor_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_uploaded_by_user_id_fkey" FOREIGN KEY ("organization_id", "uploaded_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual addition (not expressible via Prisma's schema DSL — no native
-- @@check attribute in this Prisma version): a PROFORMA invoice must never
-- carry a journal entry, since it is not a revenue-recognition event and
-- must never post to the ledger.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_proforma_no_journal_entry_check"
    CHECK (invoice_type <> 'PROFORMA' OR journal_entry_id IS NULL);
