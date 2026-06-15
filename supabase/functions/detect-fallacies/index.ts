// Supabase Edge Function - POST /functions/v1/detect-fallacies
// Accepts { transcript } and returns { fallacies: { passage_quote, fallacy_type, severity, explanation }[] }.
// Layer 3 of the Fact Checker: scans a discussion transcript for logical fallacies.

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_TRANSCRIPT  = 200_000

const VALID_FALLACIES = [
  'ad_hominem',
  'straw_man',
  'false_dilemma',
  'slippery_slope',
  'appeal_to_authority',
  'appeal_to_emotion',
  'hasty_generalization',
  'post_hoc',
  'circular_reasoning',
  'red_herring',
  'equivocation',
  'anecdotal'
]

const VALID_SEVERITIES = ['minor', 'moderate', 'serious']

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
  if (!transcript || transcript.length < 50) {
    return json({ error: 'Transcript is too short.' }, { status: 400 })
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return json({ error: `Transcript too long (${transcript.length}).` }, { status: 413 })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase secrets.' }, { status: 500 })

  const systemPrompt =
    "You scan a discussion transcript for logical fallacies. Flag only clear instances, " +
    "not stylistic choices or marginal cases. It is fine -- even common -- to find zero fallacies.\n\n" +
    "Use ONLY these twelve fallacy categories:\n\n" +
    "  - \"ad_hominem\":             attacking the person rather than the argument\n" +
    "  - \"straw_man\":              misrepresenting an opponent's view to attack a weaker version\n" +
    "  - \"false_dilemma\":          presenting only two options when more exist\n" +
    "  - \"slippery_slope\":         claiming one step will inevitably lead to extreme consequences\n" +
    "  - \"appeal_to_authority\":    citing an authority outside their expertise, or treating one expert as conclusive\n" +
    "  - \"appeal_to_emotion\":      substituting emotional manipulation for evidence\n" +
    "  - \"hasty_generalization\":   drawing a broad conclusion from a small or unrepresentative sample\n" +
    "  - \"post_hoc\":               assuming that because B followed A, A caused B\n" +
    "  - \"circular_reasoning\":     using the conclusion as a premise (begging the question)\n" +
    "  - \"red_herring\":            introducing irrelevant material to distract from the argument\n" +
    "  - \"equivocation\":           shifting the meaning of a key term mid-argument\n" +
    "  - \"anecdotal\":              treating a personal story or single instance as proof of a general claim\n\n" +
    "For each fallacy you find, output:\n" +
    "  - \"passage_quote\":   the smallest direct quote from the transcript that contains the fallacy\n" +
    "  - \"fallacy_type\":    one of the twelve strings above\n" +
    "  - \"severity\":        \"minor\" | \"moderate\" | \"serious\" (judged by how central the fallacy is to the argument)\n" +
    "  - \"explanation\":     one or two sentences explaining why this passage is the fallacy you labeled it\n\n" +
    "Be conservative. If a passage is debatable, leave it out. Do not invent quotes -- only use text that actually appears in the transcript.\n\n" +
    "Respond with ONLY valid JSON (no markdown fence, no prose):\n" +
    "{\n" +
    "  \"fallacies\": [\n" +
    "    { \"passage_quote\": \"...\", \"fallacy_type\": \"straw_man\", \"severity\": \"moderate\", \"explanation\": \"...\" }\n" +
    "  ]\n" +
    "}\n\n" +
    "If you find none, return { \"fallacies\": [] }."

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
        messages: [{ role: 'user', content: `Transcript:\n${transcript}` }]
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

  const raw: any[] = Array.isArray(parsed?.fallacies) ? parsed.fallacies : []
  const fallacies = raw
    .filter(f => f && typeof f.passage_quote === 'string' && typeof f.fallacy_type === 'string')
    .map(f => ({
      passage_quote: String(f.passage_quote).trim(),
      fallacy_type:  VALID_FALLACIES.includes(f.fallacy_type) ? f.fallacy_type : 'red_herring',
      severity:      VALID_SEVERITIES.includes(f.severity)    ? f.severity    : 'moderate',
      explanation:   typeof f.explanation === 'string' ? f.explanation.trim() : ''
    }))

  return json({ fallacies })
})
