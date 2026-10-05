import { redirect } from 'next/navigation';

/*
 * There is no separate advances screen any more: a deposit is taken and
 * seen on its quotation or job card, and applied on the invoice. An old
 * bookmark lands on the quotations.
 */
export default function AdvancesPage(): never {
  redirect('/quotations');
}
