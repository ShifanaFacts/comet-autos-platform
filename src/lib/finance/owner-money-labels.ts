/** What each kind of owner's money is called — in the journal and on screen. */
export const OWNER_MONEY_LABEL = {
  CAPITAL_IN: "Owner's money put in",
  LOAN_IN: "Owner's loan to the business",
  DRAWINGS: "Owner's drawings",
} as const;

export type OwnerMoneyKindKey = keyof typeof OWNER_MONEY_LABEL;
