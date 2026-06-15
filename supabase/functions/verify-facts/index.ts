// Supabase Edge Function - POST /functions/v1/verify-facts
// Accepts { facts: string[] } and returns { results: { label, reasoning }[] }
// in the same order. Used by the Fact Checker layer of the Argument Analyzer.
//
// Deploy:
//   supabase functions deploy verify-facts --no-verify-jwt

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_FACTS       = 30

const VALID_LABELS = ['true', 'false', 'partly_true', 'unverifiable', 'disputed', 'outdated']

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...(init.headers ?? {}) }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'Use POST' }, { status: 405 })

  let body: any
  try { body = await req.json() }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }) }

  const facts: string[] = Array.isArray(body?.facts)
    ? body.facts.filter((f: any) => typeof f === 'string' && f.trim())
    : []
  if (facts.length === 0) return json({ error: 'No facts provided.' }, { status: 400 })
  if (facts.length > MAX_FACTS) return json({ error: `Too many facts (${facts.length}); max ${MAX_FACTS} per request.` }, { status: 413 })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase secrets.' }, { status: 500 })

  const systemPrompt =
    "You are a careful fact-checker. For each numbered fact, assign exactly ONE of " +
    "these labels:\n\n" +
    "  - \"true\":         well-supported by mainstream evidence; widely accepted as accurate\n" +
    "  - \"false\":        contradicted by mainstream evidence; demonstrably incorrect\n" +
    "  - \"partly_true\":  contains a mixture of accurate and inaccurate elements\n" +
    "  - \"unverifiable\": no credible evidence either way; cannot be confirmed or refuted\n" +
    "  - \"disputed\":     credible sources disagree; remains genuinely contested\n" +
    "  - \"outdated\":     was once accurate but is no longer\n\n" +
    "For each fact, provide:\n" +
    "  - \"label\":     one of the six strings above, lowercased, with underscore for partly_true\n" +
    "  - \"reasoning\": one or two clear sentences explaining your label\n\n" +
    "Be honest about uncertainty. If you genuinely don't know, use \"unverifiable\". " +
    "Do not invent citations or sources. Avoid hedging language in reasoning -- " +
    "just state what you actually know.\n\n" +
    "Respond with ONLY valid JSON in this exact shape (no markdown fence, no prose):\n" +
    "{\n" +
    "  \"results\": [\n" +
    "    { \"label\": \"true\", \"reasoning\": \"...\" },\n" +
    "    { \"label\": \"disputed\", \"reasoning\": \"...\" }\n" +
    "  ]\n" +
    "}\n\n" +
    "The results array MUST have exactly one entry per fact, in the same order they appear."

  const factList = facts.map((f, i) => `${i + 1}. ${f}`).join('\n')

  let aRes: Response
  try {
    aRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type':       'application/json',
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Facts to evaluate:\n${factList}` }]
      })
    })
  } catch (e) {
    return json({ error: `Failed to reach Anthropic: ${(e as Error).message}` }, { status: 502 })
  }

  if (!aRes.ok) {
    const txt = await aRes.text()
    return json({ error: `Anthropic returned ${aRes.status}: ${txt}` }, { status: 502 })
  }

  const data = await aRes.json()
  const text: string = (data?.content ?? [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()

  let parsed: any
  try {
    const m = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(m ? m[0] : text)
  } catch {
    return json({ error: `Could not parse Claude response: ${text.slice(0, 300)}` }, { status: 502 })
  }

  const raw: any[] = Array.isArray(parsed?.results) ? parsed.results : []
  if (raw.length !== facts.length) {
    return json({ error: `Expected ${facts.length} results, got ${raw.length}.` }, { status: 502 })
  }

  // Sanitize labels
  const results = raw.map((r: any) => ({
    label: VALID_LABELS.includes(r?.label) ? r.label : 'unverifiable',
    reasoning: typeof r?.reasoning === 'string' ? r.reasoning.trim() : ''
  }))

  return json({ results })
})
