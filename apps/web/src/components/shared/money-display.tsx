const formatter = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  minimumFractionDigits: 2,
});

export function MoneyDisplay({ amount }: { amount: number }) {
  return <span className="tabular-nums">{formatter.format(amount)}</span>;
}
