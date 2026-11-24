export const estimateTokens = (s) => Math.ceil(s.length / 4)

export const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export const words = (s) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])

export function jaccard(a, b) {
  let shared = 0
  for (const x of a) if (b.has(x)) shared++
  const union = a.size + b.size - shared
  return union ? shared / union : 0
}
