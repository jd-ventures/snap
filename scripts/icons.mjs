// Three PNG icons, drawn by hand so the build needs no image library: a
// rounded red square (the annotate ink) with a white sheet inset. Writes
// public/icons/{16,48,128}.png. Run once: `npm run icons`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}

function png(size) {
  const rows = []
  const r = Math.round(size * 0.22)
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      const cx = Math.max(r - x, x - (size - 1 - r), 0)
      const cy = Math.max(r - y, y - (size - 1 - r), 0)
      const out = cx * cx + cy * cy > r * r
      const inset = Math.round(size * 0.28)
      const sheet = x >= inset && x < size - inset && y >= inset && y < size - inset
      if (out) row.push(0, 0, 0, 0)
      else if (sheet) row.push(255, 255, 255, 255)
      else row.push(224, 0, 0, 255)
    }
    rows.push(Buffer.from(row))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public/icons', { recursive: true })
for (const size of [16, 48, 128]) writeFileSync(`public/icons/${size}.png`, png(size))
console.log('icons written to public/icons')
