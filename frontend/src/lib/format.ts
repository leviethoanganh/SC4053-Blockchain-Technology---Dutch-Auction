/** 1e18: wei per ETH, and base units per whole token (18 decimals). */
export const WAD = 10n ** 18n

/** Parse a decimal ETH string ("0.25") into wei. Throws on bad input. */
export function parseEth(value: string): bigint {
  const s = value.trim()
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') throw new Error('Enter a number, like 0.05')
  const [whole = '0', frac = ''] = s.split('.')
  if (frac.length > 18) throw new Error('Use at most 18 decimal places')
  return BigInt(whole || '0') * WAD + BigInt(frac.padEnd(18, '0') || '0')
}

/**
 * Format an 18-decimal amount. Truncates (never rounds up), so the UI never
 * shows more than the contract would pay out.
 */
export function formatUnits(value: bigint, maxDecimals = 6, minDecimals = 0): string {
  const negative = value < 0n
  const v = negative ? -value : value
  const whole = v / WAD
  let frac = (v % WAD).toString().padStart(18, '0').slice(0, maxDecimals)
  while (frac.length > minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1)
  const wholeText = whole.toLocaleString('en-US')
  return `${negative ? '-' : ''}${wholeText}${frac ? `.${frac}` : ''}`
}

/** Price in ETH per token, always with enough digits to see it move. */
export function formatPrice(wei: bigint): string {
  return formatUnits(wei, 6, 6)
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Seconds → "mm:ss". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Share of a in b as a 0–100 number. */
export function percent(a: bigint, b: bigint): number {
  if (b === 0n) return 0
  return Number((a * 10_000n) / b) / 100
}
