-- Inventory ledger movement types (additive). New enum values can't be used
-- in the transaction that adds them, so the constraints that reference them
-- live in the next migration.
ALTER TYPE "InventoryTransactionType" ADD VALUE 'OPENING_STOCK';
ALTER TYPE "InventoryTransactionType" ADD VALUE 'JOB_RETURN';
ALTER TYPE "InventoryTransactionType" ADD VALUE 'REVERSAL';
