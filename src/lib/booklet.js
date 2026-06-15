// Casa Class — booklet PDF generator.
// Produces a print-ready PDF on 11" x 8.5" landscape sheets, imposed for
// saddle-stitch single-fold booklets (4 booklet pages per physical sheet).
// Booklet pages are 5.5" x 8.5" portrait.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PT_PER_IN = 72
const PAGE_W  = 5.5 * PT_PER_IN   // 396 — half-sheet width
const PAGE_H  = 8.5 * PT_PER_IN   // 612 — half-sheet height (also full sheet height)
const SHEET_W = 11  * PT_PER_IN   // 792 — full sheet width (landscape)
const SHEET_H = 8.5 * PT_PER_IN   // 612
const MARGIN  = 0.5 * PT_PER_IN   // 36

// Colors (RGB values 0..1)
const INK    = rgb(0.12, 0.16, 0.22)
const MUTED  = rgb(0.45, 0.45, 0.50)
const ACCENT = rgb(0.96, 0.62, 0.04)  // sunrise gold

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatDateLong(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

function formatDateShort(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

// Strip characters that pdf-lib's WinAnsi encoding can't represent (e.g.
// emoji, smart-quote artifacts, em-dashes). For safety we substitute common
// ones and drop the rest.
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
    // Drop anything outside the printable WinAnsi range, just in case.
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
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

function drawWrapped(page, text, opts) {
  const { x, font, size, lineHeight, color = INK, maxWidth, minY = 0 } = opts
  let y = opts.y
  const lines = wrapText(text, font, size, maxWidth)
  for (const line of lines) {
    if (y < minY) return { y, truncated: true }
    if (line) page.drawText(line, { x, y, font, size, color })
    y -= lineHeight
  }
  return { y, truncated: false }
}

function drawCentered(page, text, opts) {
  const { y, font, size, color = INK, cx } = opts
  const w = font.widthOfTextAtSize(clean(text), size)
  page.drawText(clean(text), { x: cx - w / 2, y, font, size, color })
}

// ---------------------------------------------------------------------------
// Booklet-page renderers. Each draws into a 5.5" x 8.5" slot whose
// bottom-left corner on the physical sheet is at (ox, oy).
// ---------------------------------------------------------------------------

function drawCover(page, ox, oy, fonts, ctx) {
  const cx = ox + PAGE_W / 2

  // Sunburst at top
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

  // Title
  let y = sunY - 1.4 * PT_PER_IN
  drawCentered(page, ctx.groupName, { y, font: fonts.serifBold, size: 34, cx })
  y -= 22
  drawCentered(page, 'Discussion Group', { y, font: fonts.serif, size: 16, color: MUTED, cx })

  // Divider
  y -= 28
  page.drawLine({
    start: { x: cx - 70, y }, end: { x: cx + 70, y },
    thickness: 0.8, color: ACCENT
  })

  // Subtitle + date range
  y -= 28
  drawCentered(page, 'AI summaries anthology', { y, font: fonts.serifItalic, size: 13, color: MUTED, cx })

  if (ctx.dateRange) {
    y -= 18
    drawCentered(page, ctx.dateRange, { y, font: fonts.body, size: 11, color: MUTED, cx })
  }

  // Footer note
  drawCentered(page, 'Compiled from the Casa Class app', {
    y: oy + MARGIN, font: fonts.italic, size: 8, color: MUTED, cx
  })
}

function drawTOC(page, ox, oy, fonts, ctx) {
  const innerL = ox + MARGIN
  const innerR = ox + PAGE_W - MARGIN
  let y = oy + PAGE_H - MARGIN - 22

  page.drawText('Table of contents', { x: innerL, y, font: fonts.serifBold, size: 22, color: INK })
  y -= 10
  page.drawLine({
    start: { x: innerL, y }, end: { x: innerR, y },
    thickness: 0.6, color: ACCENT
  })
  y -= 22

  const entrySize = 10.5
  const lineH = 17
  const bottomReserve = oy + MARGIN + 36  // leave room for URL

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

  // URL at bottom centered
  const url = ctx.projectUrl
  const urlSize = 9
  const urlW = fonts.body.widthOfTextAtSize(url, urlSize)
  const cx = ox + PAGE_W / 2
  // Thin separator above the URL
  page.drawLine({
    start: { x: cx - 80, y: oy + MARGIN + 20 },
    end:   { x: cx + 80, y: oy + MARGIN + 20 },
    thickness: 0.4, color: MUTED
  })
  page.drawText(url, { x: cx - urlW / 2, y: oy + MARGIN + 6, font: fonts.body, size: urlSize, color: INK })
}

function drawPresentation(page, ox, oy, fonts, bp, ctx) {
  const innerL = ox + MARGIN
  const innerR = ox + PAGE_W - MARGIN
  const innerW = innerR - innerL
  let y = oy + PAGE_H - MARGIN - 12

  const p = bp.pres

  // Date (small, italic, muted)
  page.drawText(formatDateLong(p.scheduled_date), {
    x: innerL, y, font: fonts.italic, size: 9, color: MUTED
  })
  y -= 18

  // Title (display serif)
  const titleSize = 17
  const titleLines = wrapText(p.topic_title || '(Untitled)', fonts.serifBold, titleSize, innerW)
  for (const line of titleLines) {
    page.drawText(line, { x: innerL, y, font: fonts.serifBold, size: titleSize, color: INK })
    y -= titleSize + 3
  }
  y -= 2

  // Speaker(s)
  const sp = ctx.speakers.find(s => s.id === p.speaker_id)
  const coNames = (p.co_speaker_ids ?? [])
    .map(id => ctx.speakers.find(s => s.id === id)?.name)
    .filter(Boolean)
  let speakerStr = sp?.name || 'Speaker not recorded'
  if (coNames.length) speakerStr += ' with ' + coNames.join(', ')
  page.drawText(speakerStr, { x: innerL, y, font: fonts.body, size: 11, color: MUTED })
  y -= 18

  // Accent divider
  page.drawLine({
    start: { x: innerL, y }, end: { x: innerL + 40, y },
    thickness: 1.2, color: ACCENT
  })
  y -= 18

  // Summary body
  const resources = ctx.resourcesForPres[p.id] || []
  const resReserve = resources.length ? 22 + 14 * Math.min(resources.length, 4) : 0
  const minY = oy + MARGIN + Math.max(28, resReserve)

  const r = drawWrapped(page, p.summary, {
    x: innerL, y, maxWidth: innerW,
    font: fonts.body, size: 9.5, lineHeight: 13.5,
    color: INK, minY
  })
  y = r.y

  // Resources block at bottom
  if (resources.length) {
    y -= 6
    if (y > oy + MARGIN + 18) {
      page.drawText('Recommended resources', { x: innerL, y, font: fonts.bold, size: 9, color: ACCENT })
      y -= 12
      for (const res of resources) {
        if (y < oy + MARGIN + 8) break
        const labelParts = []
        labelParts.push('- ' + clean(res.title || '(untitled)'))
        if (res.url) labelParts.push('(' + clean(res.url) + ')')
        if (res.kind) labelParts.push('[' + clean(res.kind) + ']')
        const label = labelParts.join(' ')
        const lines = wrapText(label, fonts.body, 8.5, innerW)
        for (const line of lines) {
          if (y < oy + MARGIN + 8) break
          page.drawText(line, { x: innerL, y, font: fonts.body, size: 8.5, color: INK })
          y -= 11
        }
      }
    }
  }
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
    case 'cover':        drawCover(page, ox, oy, fonts, ctx); return
    case 'toc':          drawTOC(page, ox, oy, fonts, ctx); return
    case 'presentation':
      drawPresentation(page, ox, oy, fonts, bp, ctx)
      drawPageNumber(page, pageNum, ox, oy, fonts)
      return
    case 'missing':
      drawMissingList(page, ox, oy, fonts, bp.items, ctx)
      drawPageNumber(page, pageNum, ox, oy, fonts)
      return
  }
}

// ---------------------------------------------------------------------------
// Top-level: build the booklet PDF
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Array} opts.presentations  All presentation rows
 * @param {Array} opts.speakers       All speaker rows
 * @param {Array} opts.resources      All resource rows (any presentation)
 * @param {string} [opts.groupName]
 * @param {string} [opts.projectUrl]
 * @returns {Promise<Blob>}
 */
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

  // Booklet pages, 1-indexed: 1=cover, 2=TOC, 3..K+2=presentations, K+3=missing
  const tocEntries = withSummary.map((p, i) => ({
    date: p.scheduled_date,
    title: p.topic_title || '(Untitled)',
    pageNum: i + 3
  }))

  const resourcesForPres = {}
  for (const r of (resources || [])) {
    if (!resourcesForPres[r.presentation_id]) resourcesForPres[r.presentation_id] = []
    resourcesForPres[r.presentation_id].push(r)
  }

  // Date range for cover
  let dateRange = ''
  if (sorted.length) {
    const first = formatDateShort(sorted[0].scheduled_date)
    const last  = formatDateShort(sorted[sorted.length - 1].scheduled_date)
    dateRange = first === last ? first : `${first} - ${last}`
  }

  // Reading order
  const bookletPages = []
  bookletPages.push({ type: 'cover' })
  bookletPages.push({ type: 'toc' })
  withSummary.forEach(p => bookletPages.push({ type: 'presentation', pres: p }))
  bookletPages.push({ type: 'missing', items: withoutSummary })

  // Pad to a multiple of 4 with blanks
  while (bookletPages.length % 4 !== 0) {
    bookletPages.push({ type: 'blank' })
  }
  const N = bookletPages.length
  const sheets = N / 4

  // Build the PDF
  const pdf = await PDFDocument.create()
  const fonts = {
    body:        await pdf.embedFont(StandardFonts.Helvetica),
    bold:        await pdf.embedFont(StandardFonts.HelveticaBold),
    italic:      await pdf.embedFont(StandardFonts.HelveticaOblique),
    serif:       await pdf.embedFont(StandardFonts.TimesRoman),
    serifBold:   await pdf.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await pdf.embedFont(StandardFonts.TimesRomanItalic)
  }

  pdf.setTitle(`${groupName} - AI summaries anthology`)
  pdf.setAuthor(groupName)
  pdf.setCreator('Casa Class app')
  pdf.setProducer('pdf-lib')

  const ctx = { groupName, projectUrl, dateRange, tocEntries, speakers, resourcesForPres }

  // Saddle-stitch imposition. For 0-indexed sheet s (0..sheets-1):
  //   Front (outer): left = page[N-2s-1], right = page[2s]
  //   Back  (inner): left = page[2s+1],   right = page[N-2s-2]
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
