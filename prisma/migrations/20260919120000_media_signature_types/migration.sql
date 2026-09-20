-- New document category for signature images (added alone: a new enum value can't be used in the transaction that adds it).
ALTER TYPE "DocumentCategory" ADD VALUE 'SIGNATURE';
