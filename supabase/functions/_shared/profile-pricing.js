export const MONTHLY_PER_COMMERCE = 2000;
export function activationFee(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('invalid_rank');
  return [5000,3000,2500,2000][ordinal-1] ?? 1500;
}
export function activationTotal(alreadyConfirmed, quantity = 1) {
  if (!Number.isSafeInteger(alreadyConfirmed) || alreadyConfirmed < 0 || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('invalid_quantity');
  return Array.from({length:quantity},(_,i)=>activationFee(alreadyConfirmed+i+1)).reduce((a,b)=>a+b,0);
}
export function monthlyTotal(count) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid_quantity');
  return count * MONTHLY_PER_COMMERCE;
}
export function prepaidProration(currentMonthly, newMonthly, start, end, effective, months) {
  const remaining=Math.max(0,Math.min(end-effective,end-start));
  if (!(end>start) || !Number.isSafeInteger(months) || months<1 || newMonthly<currentMonthly) throw new Error('invalid_prepaid_period');
  return Math.round((newMonthly-currentMonthly)*months*remaining/(end-start));
}
