/** Credit formatting. One credit is one rupee, whole numbers only. */

export function formatCredits(credits) {
  const n = Number(credits || 0)
  const abs = Math.abs(n)
  const body = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n < 0 ? '-' : ''}₹${body}`
}

export function formatCreditDelta(credits) {
  const n = Number(credits || 0)
  const abs = Math.abs(n)
  const body = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n >= 0 ? '+' : '-'}${body}`
}
