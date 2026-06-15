// Supabase Edge Function - POST /functions/v1/analyze-distortion
// Accepts { transcript, facts: string[] } and returns { results: { label, reasoning }[] }.
// Layer 2 of the Fact Checker: how were verified-true facts actually presented?
//
// Deploy:
//   supabase functions deploy analyze-distortion --no-verify-jwt

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_FACTS       = 15           // smaller batch because transcript is also in context
const MAX_TRANSCRIPT  = 200_000

const VALID_LABELS = [
  'exaggerated',
  'understated',
  'misleading',
  'cherry_picked',
  'missing_context',
  'conflation',
  'undistorted'
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
  try { body = await req.json() }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }) }

  const transcript: string = (body?.transcript ?? '').toString()
  const facts: string[] = Array.isArray(body?.facts)
    ? body.facts.filter((f: any) => typeof f === 'string' && f.trim())
    : []

  if (!transcript || transcript.length < 50) {
    return json({ error: 'Transcript is required for distortion analysis.' }, { status: 400 })
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return json({ error: `Transcript too long (${transcript.length}).` }, { status: 413 })
  }
  if (facts.length === 0) return json({ error: 'No facts provided.' }, { status: 400 })
  if (facts.length > MAX_FACTS) return json({ error: `Too many facts (${facts.length}); max ${MAX_FACTS} per request.` }, { status: 413 })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase secrets.' }, { status: 500 })

  const systemPrompt =
    "You analyze how factual claims were presented in a discussion transcript.\n\n" +
    "Each fact below has already been verified as accurate. Your job is to judge " +
    "whether the WAY the speaker presented it introduced distortion. Assign exactly " +
    "ONE of these labels to each fact:\n\n" +
    "  - \"exaggerated\":      magnitude or significance was overstated beyond what evidence supports\n" +
    "  - \"understated\":      magnitude or significance was downplayed beyond what evidence supports\n" +
    "  - \"misleading\":       technically true but the framing creates a false impression\n" +
    "  - \"cherry_picked\":    selectively presented; omits relevant counter-facts that would change the picture\n" +
    "  - \"missing_context\":  presented without context a listener needs to interpret it correctly\n" +
    "  - \"conflation\":       two distinct things were merged or confused with each other\n" +
    "  - \"undistorted\":      the fact was presented accurately and in proper context\n\n" +
    "Be conservative. If the presentation seems reasonable and faithful to the evidence, " +
    "use \"undistorted\". Don't manufacture distortions where there are none. When you do " +
    "see distortion, ground your reasoning in what the speaker actually said.\n\n" +
    "For each fact, provide:\n" +
    "  - \"label\":     one of the seven strings above (lowercased, underscores as shown)\n" +
    "  - \"reasoning\": one or two sentences explaining your judgment, referencing how the fact appeared in the transcript\n\n" +
    "Respond with ONLY valid JSON in this exact shape (no markdown fence, no prose):\n" +
    "{\n" +
    "  \"results\": [\n" +
    "    { \"label\": \"undistorted\", \"reasoning\": \"...\" },\n" +
    "    { \"label\": \"missing_context\", \"reasoning\": \"...\" }\n" +
    "  ]\n" +
    "}\n\n" +
    "The results array MUST have exactly one entry per fact, in the same order."

  const factList = facts.map((f, i) => `${i + 1}. ${f}`).join('\n')
  const userContent =
    `Transcript:\n${transcript}\n\n` +
    `Facts to analyze for distortion (one per number):\n${factList}`

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

  const results = raw.map((r: any) => ({
    label: VALID_LABELS.includes(r?.label) ? r.label : 'undistorted',
    reasoning: typeof r?.reasoning === 'string' ? r.reasoning.trim() : ''
  }))

  return json({ results })
})
