import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

/**
 * Subscribe to a Supabase table and keep a local copy in sync.
 */
export function useTable(table, opts = {}) {
  const { orderBy, ascending = true, filter } = opts
  const filterKey = filter ? JSON.stringify(filter) : ''

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    let query = supabase.from(table).select('*')
    if (filter) {
      for (const [k, v] of Object.entries(filter)) {
        query = query.eq(k, v)
      }
    }
    if (orderBy) query = query.order(orderBy, { ascending })
    const { data, error } = await query
    if (error) setError(error)
    else setRows(data || [])
    setLoading(false)
  }, [table, orderBy, ascending, filterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel(`realtime:${table}:${filterKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => fetchAll()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, filterKey, fetchAll])

  return { rows, loading, error, refresh: fetchAll }
}
