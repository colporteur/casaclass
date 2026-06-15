// Supabase Edge Function - POST /functions/v1/assess-evidence
// Accepts { transcript, facts: string[] } and returns { results: { label, reasoning }[] }.
// Layer 4: For each verified-true fact, what kind of evidence/support did the speaker actually offer?

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_FACTS       = 15
const MAX_TRANSCRIPT  = 200_000

const VALID_LABELS = [
  'primary_source',
  'secondary_source',
  'vague_appeal',
  'anecdote',
  'no_support'
]

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
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, { status: 400 }) }

  const transcript: string = (body?.transcript ?? '').toString()
  const facts: string[] = Array.isArray(body?.facts)
    ? body.facts.filter((f: any) => typeof f === 'string' && f.trim())
    : []

  if (!transcript || transcript.length < 50) return json({ error: 'Transcript required.' }, { status: 400 })
  if (transcript.length > MAX_TRANSCRIPT) return json({ error: `Transcript too long.` }, { status: 413 })
  if (facts.length === 0) return json({ error: 'No facts provided.' }, { status: 400 })
  if (facts.length > MAX_FACTS) return json({ error: `Too many facts (max ${MAX_FACTS}).` }, { status: 413 })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set.' }, { status: 500 })

  const systemPrompt =
    "For each numbered fact, judge the QUALITY OF SUPPORT the speaker actually offered in the transcript. " +
    "You are not re-evaluating whether the fact is true -- it is already verified. You are evaluating the " +
    "speaker's evidence-handling. Assign exactly ONE label:\n\n" +
    "  - \"primary_source\":    speaker cited or quoted an identifiable primary source (paper, dataset, document, named study)\n" +
    "  - \"secondary_source\":  speaker cited a recognizable secondary source (named book, named article, named expert with discipline)\n" +
    "  - \"vague_appeal\":      speaker invoked support without identifying it (\"studies show\", \"experts agree\", \"research finds\")\n" +
    "  - \"anecdote\":          speaker offered a personal story, single example, or hearsay as the basis\n" +
    "  - \"no_support\":        the fact was stated without any attempt at support\n\n" +
    "For each fact, output:\n" +
    "  - \"label\":     one of the five strings above (lowercased, underscores as shown)\n" +
    "  - \"reasoning\": one sentence noting what (if anything) the speaker offered as support\n\n" +
    "Respond with ONLY valid JSON (no markdown, no prose):\n" +
    "{\n  \"results\": [\n    { \"label\": \"vague_appeal\", \"reasoning\": \"...\" }\n  ]\n}\n\n" +
    "The results array MUST have exactly one entry per fact, in the same order."

  const factList = facts.map((f, i) => `${i + 1}. ${f}`).join('\n')
  const userContent = `Transcript:\n${transcript}\n\nFacts to assess (one per number):\n${factList}`

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
        messages: [{ role: 'user', content: userContent }]
      })
    })
  } catch (e) {
    return json({ error: `Failed to reach Anthropic: ${(e as Error).message}` }, { status: 502 })
  }

  if (!aRes.ok) return json({ error: `Anthropic returned ${aRes.status}: ${await aRes.text()}` }, { status: 502 })

  const data = await aRes.json()
  const text: string = (data?.content ?? [])
    .filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim()

  let parsed: any
  try {
    const m = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(m ? m[0] : text)
  } catch {
    return json({ error: `Could not parse Claude response: ${text.slice(0, 300)}` }, { status: 502 })
  }

  const raw: any[] = Array.isArray(parsed?.results) ? parsed.results : []
  if (raw.length !== facts.length) return json({ error: `Expected ${facts.length} results, got ${raw.length}.` }, { status: 502 })

  const results = raw.map((r: any) => ({
    label: VALID_LABELS.includes(r?.label) ? r.label : 'no_support',
    reasoning: typeof r?.reasoning === 'string' ? r.reasoning.trim() : ''
  }))

  return json({ results })
})
