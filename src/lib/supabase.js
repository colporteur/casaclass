import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Casa Class] Supabase env vars are missing. ' +
    'Create a .env.local file (see .env.example) before running the app.'
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: false }
})

const FUNCTION_BASE = url ? `${url}/functions/v1` : ''

export const SUMMARIZE_FUNCTION_URL =
  import.meta.env.VITE_SUMMARIZE_FUNCTION_URL ?? `${FUNCTION_BASE}/summarize`

export const EXTRACT_FACTS_URL = `${FUNCTION_BASE}/extract-facts`
export const VERIFY_FACTS_URL  = `${FUNCTION_BASE}/verify-facts`

export const SUPABASE_ANON_KEY = anonKey ?? ''
