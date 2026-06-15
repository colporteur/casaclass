// Casa Class - booklet PDF generator.
// Produces a print-ready PDF on 11" x 8.5" landscape sheets, imposed for
// saddle-stitch single-fold booklets (4 booklet pages per physical sheet).
// Booklet pages are 5.5" x 8.5" portrait.
//
// Layout: each program with an AI summary occupies as many booklet pages as
// its content needs. The first page carries the header (date, title, speaker);
// continuation pages show a small "continued" marker. The full booklet is
// padded with blanks to a multiple of 4 pages.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PT_PER_IN = 72
const PAGE_W  = 5.5 * PT_PER_IN
const PAGE_H  = 8.5 * PT_PER_IN
const SHEET_W = 11  * PT_PER_IN
const SHEET_H = 8.5 * PT_PER_IN
const MARGIN  = 0.5 * PT_PER_IN

// Colors
const INK    = rgb(0.12, 0.16, 0.22)
const MUTED  = rgb(0.45, 0.45, 0.50)
const ACCENT = rgb(0.96, 0.62, 0.04)

// Reserved bottom strip for page number (so it never collides with content)
const PAGE_NUM_RESERVE = 28
// Top padding before any header content
const TOP_PAD = 12
// Total vertical area usable for layout (between top of page-num and top pad)
const FULL_AVAIL = PAGE_H - 2 * MARGIN - PAGE_NUM_RESERVE - TOP_PAD

// ---------------------------------------------------------------------------
// Text + date helpers
// ---------------------------------------------------------------------------

function clean(text) {
  if (text == null) return ''
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')
    .replace(/–/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '*')
    .replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
}

function formatDateLong(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function formatDateShort(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function wrapText(text, font, size, maxWidth) {
  const t = clean(text)
  if (!t) return []
  const out = []
  for (const para of t.split('\n')) {
    if (!para.trim()) { out.push(''); continue }
    const words = para.split(/\s+/)
    let current = ''
    for (const w of words) {
      const trial = current ? current + ' ' + w : w
      const width = font.widthOfTextAtSize(trial, size)
      if (width > maxWidth && current) {
        out.push(current)
        current = w
      } else {
        current = trial
      }
    }
    if (current) out.push(current)
  }
  return out
}

function truncateToWidth(text, font, size, maxWidth) {
  let s = clean(text)
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s
  while (s.length > 0 && font.widthOfTextAtSize(s + '...', size) > maxWidth) {
    s = s.slice(0, -1)
  }
  return s + '...'
}

function drawCentered(page, text, opts) {
  const { y, font, size, color = INK, cx } = opts
  const t = clean(text)
  const w = font.widthOfTextAtSize(t, size)
  page.drawText(t, { x: cx - w / 2, y, font, size, color })
}

// ---------------------------------------------------------------------------
// Item-based content model. Items are drawn in order, each consuming a known
// vertical amount. Chunking splits the items across pages by capacity.
// ---------------------------------------------------------------------------

function buildPresentationItems(pres, resources, fonts) {
  const innerW = PAGE_W - 2 * MARGIN
  const items = []

  // Summary lines
  const summaryLines = wrapText(pres.summary || '', fonts.body, 9.5, innerW)
  for (const line of summaryLines) {
    if (line === '') {
      items.push({ type: 'space', height: 6 })
    } else {
      items.push({ type: 'text', text: line, font: 'body', size: 9.5, lineHeight: 13.5, color: INK })
    }
  }

  // Resources block
  if (resources && resources.length) {
    items.push({ type: 'space', height: 10 })
    items.push({ type: 'text', text: 'Recommended resources', font: 'bold', size: 9, lineHeight: 13, color: ACCENT })
    for (const r of resources) {
      const labelParts = []
      labelParts.push('- ' + (r.title || '(untitled)'))
      if (r.url)  labelParts.push('(' + r.url + ')')
      if (r.kind) labelParts.push('[' + r.kind + ']')
      const label = labelParts.join(' ')
      const lines = wrapText(label, fonts.body, 8.5, innerW)
      for (const line of lines) {
        items.push({ type: 'text', text: line, font: 'body', size: 8.5, lineHeight: 11, color: INK })
      }
    }
  }

  return items
}

function firstPageHeaderHeight(pres, fonts) {
  const innerW = PAGE_W - 2 * MARGIN
  const titleLines = wrapText(pres.topic_title || '(Untitled)', fonts.serifBold, 17, innerW)
  // date(18) + title(nLines*20) + gap(2) + speaker(18) + divider(18)
  return 18 + titleLines.length * 20 + 2 + 18 + 18
}

function continuationHeaderHeight() {
  // "continued" line (small italic, 6 leading) + thin divider(14)
  return 6 + 14
}

function chunkItems(items, firstCap, contCap) {
  const chunks = []
  let current = []
  let used = 0
  let cap = firstCap

  for (const item of items) {
    const h = item.type === 'space' ? item.height : item.lineHeight

    // Drop a leading space on any chunk - looks ugly at the top of a page.
    if (used === 0 && item.type === 'space') continue

    if (used + h > cap && current.length > 0) {
      chunks.push(current)
      current = []
      used = 0
      cap = contCap
      if (item.type === 'space') continue
    }

    current.push(item)
    used += h
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function layoutPresentation(pres, resources, fonts) {
  const firstCap = FULL_AVAIL - firstPageHeaderHeight(pres, fonts)
  const contCap  = FULL_AVAIL - continuationHeaderHeight()
  const items = buildPresentationItems(pres, resources, fonts)
  // Safety: if we somehow chunked to zero (no content at all), still emit one chunk
  const chunks = chunkItems(items, Math.max(50, firstCap), Math.max(50, contCap))
  return chunks.length === 0 ? [[]] : chunks
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawItems(page, items, ox, fonts, startY) {
  let y = startY
  const innerL = ox + MARGIN
  for (const item of items) {
    if (item.type === 'space') {
      y -= item.height
      continue
    }
    if (item.type === 'text') {
      const font = fonts[item.font] || fonts.body
      if (item.text) {
        page.drawText(item.text, { x: innerL, y, font, size: item.size, color: item.color })
      }
      y -= item.lineHeight
    }
  }
  return y
}

function drawFirstPageHeader(page, ox, oy, pres, fonts, ctx) {
  const innerL = ox + MARGIN
  const innerR = ox + PAGE_W - MARGIN
  const innerW = innerR - innerL
  let y = oy + PAGE_H - MARGIN - TOP_PAD

  // Date
  page.drawText(formatDateLong(pres.scheduled_date), {
    x: innerL, y, font: fonts.italic, size: 9, color: MUTED
  })
  y -= 18

  // Title (may wrap multiple lines)
  const titleSize = 17
  const titleLines = wrapText(pres.topic_title || '(Untitled)', fonts.serifBold, titleSize, innerW)
  for (const line of titleLines) {
    page.drawText(line, { x: innerL, y, font: fonts.serifBold, size: titleSize, color: INK })
    y -= titleSize + 3
  }
  y -= 2

  // Speakers
  const sp = ctx.speakers.find(s => s.id === pres.speaker_id)
  const coNames = (pres.co_speaker_ids ?? [])
    .map(id => ctx.speakers.find(s => s.id === id)?.name)
    .filter(Boolean)
  let speakerStr = sp?.name || 'Speaker not recorded'
  if (coNames.length) speakerStr += ' with ' + coNames.join(', ')
  page.drawText(clean(speakerStr), { x: innerL, y, font: fonts.body, size: 11, color: MUTED })
  y -= 18

  // Accent divider
  page.drawLine({
    start: { x: innerL, y }, end: { x: innerL + 40, y },
    thickness: 1.2, color: ACCENT
  })
  y -= 18

  return y
}

function drawContPageHeader(page, ox, oy, pres, fonts) {
  const innerL = ox + MARGIN
  const innerR = ox + PAGE_W - MARGIN
  let y = oy + PAGE_H - MARGIN - TOP_PAD

  const titleRoom = innerR - innerL - 80
  const titleText = truncateToWidth(pres.topic_title || '(Untitled)', fonts.italic, 9, titleRoom)
  page.drawText(titleText + ', continued', {
    x: innerL, y, font: fonts.italic, size: 9, color: MUTED
  })
  y -= 6
  page.drawLine({
    start: { x: innerL, y }, end: { x: innerL + 30, y },
    thickness: 0.5, color: ACCENT
  })
  y -= 14
  return y
}

function drawCover(page, ox, oy, fonts, ctx) {
  const cx = ox + PAGE_W / 2

  // Sunburst
  const sunY = oy + PAGE_H - 1.6 * PT_PER_IN
  page.drawCircle({ x: cx, y: sunY, size: 22, color: ACCENT })
  for (let i = -2; i <= 2; i++) {
    const angle = (i * 25) * Math.PI / 180
    page.drawLine({
      start: { x: cx + Math.sin(angle) * 32, y: sunY + Math.cos(angle) * 32 },
      end:   { x: cx + Math.sin(angle) * 44, y: sunY + Math.cos(angle) * 44 },
      thickness: 2, color: ACCENT
    })
  }

  let y = sunY - 1.4 * PT_PER_IN
  drawCentered(page, ctx.groupName, { y, font: fonts.serifBold, size: 34, cx })
  y -= 22
  drawCentered(page, 'Discussion Group', { y, font: fonts.serif, size: 16, color: MUTED, cx })

  y -= 28
  page.drawLine({
    start: { x: cx - 70, y }, end: { x: cx + 70, y },
    thickness: 0.8, color: ACCENT
  })

  y -= 28
  drawCentered(page, 'AI summaries anthology', { y, font: fonts.serifItalic, size: 13, color: MUTED, cx })

  if (ctx.dateRange) {
    y -= 18
    drawCentered(page, ctx.dateRange, { y, font: fonts.body, size: 11, color: MUTED, cx })
  }

  drawCentered(page, 'Compiled from the Casa Class app', {
    y: oy + MARGIN, font: fonts.italic, size: 8, color: MUTED, cx
  })
}

function drawTOC(page, ox, oy, fonts, ctx) {
  const innerL = ox + MARGIN
  const innerR = ox + PAGE_W - MARGIN
  const innerW = innerR - innerL
  const cx = ox + PAGE_W / 2
  let y = oy + PAGE_H - MARGIN - 22

  page.drawText('Table of contents', { x: innerL, y, font: fonts.serifBold, size: 22, color: INK })
  y -= 10
  page.drawLine({
    start: { x: innerL, y }, end: { x: innerR, y },
    thickness: 0.6, color: ACCENT
  })
  y -= 22

  // Reserve space at bottom for the notice + URL
  const noticeText = 'For an online interactive guide and full session transcripts, visit:'
  const noticeLines = wrapText(noticeText, fonts.body, 9, innerW - 24)
  const urlSize = 10
  const noticeBlockHeight = noticeLines.length * 12 + 4 + urlSize + 10  // notice lines + gap + url + small bottom pad
  const bottomReserve = oy + MARGIN + noticeBlockHeight + 14

  const entrySize = 10.5
  const lineH = 17
  for (const e of ctx.tocEntries) {
    if (y < bottomReserve) break

    const date = formatDateShort(e.date)
    page.drawText(date, { x: innerL, y, font: fonts.bold, size: entrySize, color: MUTED })
    const dateW = fonts.bold.widthOfTextAtSize(date, entrySize)

    const pageStr = String(e.pageNum)
    const pageW = fonts.body.widthOfTextAtSize(pageStr, entrySize)

    const titleStartX = innerL + dateW + 10
    const titleEndX = innerR - pageW - 6
    const titleStr = truncateToWidth(e.title || '(Untitled)', fonts.body, entrySize, titleEndX - titleStartX)
    page.drawText(titleStr, { x: titleStartX, y, font: fonts.body, size: entrySize, color: INK })

    page.drawText(pageStr, { x: innerR - pageW, y, font: fonts.body, size: entrySize, color: INK })

    y -= lineH
  }

  // Bottom notice block, centered
  // Thin separator above
  const sepY = oy + MARGIN + noticeBlockHeight + 6
  page.drawLine({
    start: { x: cx - 80, y: sepY }, end: { x: cx + 80, y: sepY },
    thickness: 0.4, color: MUTED
  })

  let ny = oy + MARGIN + noticeBlockHeight - 4
  for (const line of noticeLines) {
    drawCentered(page, line, { y: ny, font: fonts.body, size: 9, color: MUTED, cx })
    ny -= 12
  }
  ny -= 4
  drawCentered(page, ctx.projectUrl, { y: ny, font: fonts.bold, size: urlSize, color: INK, cx })
}

function drawPresentationStart(page, ox, oy, fonts, bp, ctx) {
  const y = drawFirstPageHeader(page, ox, oy, bp.pres, fonts, ctx)
  drawItems(page, bp.items, ox, fonts, y)
}

function drawPresentationCont(page, ox, oy, fonts, bp, ctx) {
  const y = drawContPageHeader(page, ox, oy, bp.pres, fonts)
  drawItems(page, bp.items, ox, fonts, y)
}

function drawMissingList(page, ox, oy, fonts, items, ctx) {
  const innerL = ox + MARGIN
  const innerR = ox + PAGE_W - MARGIN
  let y = oy + PAGE_H - MARGIN - 22

  page.drawText('Meetings without summaries', { x: innerL, y, font: fonts.serifBold, size: 19, color: INK })
  y -= 10
  page.drawLine({
    start: { x: innerL, y }, end: { x: innerR, y },
    thickness: 0.6, color: ACCENT
  })
  y -= 22

  if (!items.length) {
    page.drawText('Every meeting on record has a summary.', {
      x: innerL, y, font: fonts.italic, size: 10.5, color: MUTED
    })
    return
  }

  page.drawText('Add a transcript and click "Generate summary" to include these next time.', {
    x: innerL, y, font: fonts.italic, size: 9, color: MUTED
  })
  y -= 22

  const entrySize = 10.5
  const lineH = 16
  for (const p of items) {
    if (y < oy + MARGIN + 16) break
    const date = formatDateShort(p.scheduled_date)
    page.drawText(date, { x: innerL, y, font: fonts.bold, size: entrySize, color: MUTED })
    const dateW = fonts.bold.widthOfTextAtSize(date, entrySize)
    const titleStr = truncateToWidth(p.topic_title || '(untitled)', fonts.body, entrySize, innerR - innerL - dateW - 10)
    page.drawText(titleStr, { x: innerL + dateW + 10, y, font: fonts.body, size: entrySize, color: INK })
    y -= lineH
  }
}

function drawPageNumber(page, num, ox, oy, fonts) {
  const txt = String(num)
  const size = 8
  const w = fonts.body.widthOfTextAtSize(txt, size)
  page.drawText(txt, {
    x: ox + PAGE_W / 2 - w / 2,
    y: oy + 0.28 * PT_PER_IN,
    font: fonts.body, size, color: MUTED
  })
}

function drawBookletPage(page, ox, oy, bp, pageNum, fonts, ctx) {
  if (!bp || bp.type === 'blank') return
  switch (bp.type) {
    case 'cover':              drawCover(page, ox, oy, fonts, ctx); return
    case 'toc':                drawTOC(page, ox, oy, fonts, ctx); return
    case 'presentation-start':
      drawPresentationStart(page, ox, oy, fonts, bp, ctx)
      drawPageNumber(page, pageNum, ox, oy, fonts)
      return
    case 'presentation-cont':
      drawPresentationCont(page, ox, oy, fonts, bp, ctx)
      drawPageNumber(page, pageNum, ox, oy, fonts)
      return
    case 'missing':
      drawMissingList(page, ox, oy, fonts, bp.items, ctx)
      drawPageNumber(page, pageNum, ox, oy, fonts)
      return
  }
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export async function generateBookletPdf({
  presentations,
  speakers,
  resources,
  groupName = 'Casa Class',
  projectUrl = 'https://colporteur.github.io/casaclass'
}) {
  const sorted = [...(presentations || [])].sort(
    (a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || '')
  )
  const withSummary    = sorted.filter(p => p.summary && p.summary.trim())
  const withoutSummary = sorted.filter(p => !p.summary || !p.summary.trim())

  const resourcesForPres = {}
  for (const r of (resources || [])) {
    if (!resourcesForPres[r.presentation_id]) resourcesForPres[r.presentation_id] = []
    resourcesForPres[r.presentation_id].push(r)
  }

  let dateRange = ''
  if (sorted.length) {
    const first = formatDateShort(sorted[0].scheduled_date)
    const last  = formatDateShort(sorted[sorted.length - 1].scheduled_date)
    dateRange = first === last ? first : `${first} - ${last}`
  }

  // Build the PDF + embed fonts (needed for layout measurements)
  const pdf = await PDFDocument.create()
  const fonts = {
    body:        await pdf.embedFont(StandardFonts.Helvetica),
    bold:        await pdf.embedFont(StandardFonts.HelveticaBold),
    italic:      await pdf.embedFont(StandardFonts.HelveticaOblique),
    serif:       await pdf.embedFont(StandardFonts.TimesRoman),
    serifBold:   await pdf.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await pdf.embedFont(StandardFonts.TimesRomanItalic)
  }

  // Lay out each presentation into chunks
  const presLayouts = withSummary.map(p => ({
    pres: p,
    chunks: layoutPresentation(p, resourcesForPres[p.id] || [], fonts)
  }))

  // Build booklet pages in reading order; collect TOC entries as we go.
  const bookletPages = []
  bookletPages.push({ type: 'cover' })
  bookletPages.push({ type: 'toc' })

  const tocEntries = []
  for (const { pres, chunks } of presLayouts) {
    const startPage = bookletPages.length + 1  // 1-indexed
    tocEntries.push({
      date: pres.scheduled_date,
      title: pres.topic_title || '(Untitled)',
      pageNum: startPage
    })
    chunks.forEach((items, i) => {
      if (i === 0) {
        bookletPages.push({ type: 'presentation-start', pres, items })
      } else {
        bookletPages.push({
          type: 'presentation-cont', pres, items,
          partN: i + 1, totalParts: chunks.length
        })
      }
    })
  }

  bookletPages.push({ type: 'missing', items: withoutSummary })

  // Pad with blanks so the total is a multiple of 4
  while (bookletPages.length % 4 !== 0) {
    bookletPages.push({ type: 'blank' })
  }

  const N = bookletPages.length
  const sheets = N / 4

  pdf.setTitle(`${groupName} - AI summaries anthology`)
  pdf.setAuthor(groupName)
  pdf.setCreator('Casa Class app')
  pdf.setProducer('pdf-lib')

  const ctx = { groupName, projectUrl, dateRange, tocEntries, speakers, resourcesForPres }

  // Saddle-stitch imposition: each sheet holds 4 booklet pages.
  //   Front (outer side): left = page[N-2s-1], right = page[2s]
  //   Back  (inner side): left = page[2s+1],   right = page[N-2s-2]
  for (let s = 0; s < sheets; s++) {
    const frontL = N - 2*s - 1
    const frontR = 2*s
    const backL  = 2*s + 1
    const backR  = N - 2*s - 2

    const front = pdf.addPage([SHEET_W, SHEET_H])
    drawBookletPage(front, 0,      0, bookletPages[frontL], frontL + 1, fonts, ctx)
    drawBookletPage(front, PAGE_W, 0, bookletPages[frontR], frontR + 1, fonts, ctx)

    const back = pdf.addPage([SHEET_W, SHEET_H])
    drawBookletPage(back, 0,      0, bookletPages[backL],  backL + 1, fonts, ctx)
    drawBookletPage(back, PAGE_W, 0, bookletPages[backR],  backR + 1, fonts, ctx)
  }

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}
