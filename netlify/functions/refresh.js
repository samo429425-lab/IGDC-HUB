// Netlify Scheduled Function: refresh feed data from psom.json (aligned with feed.js)
import { getStore } from '@netlify/blobs'

const FEED_NS = 'feed'
const FEED_KEY = 'data'

async function fetchJSON(url){
  const r = await fetch(url, { headers:{ 'cache-control':'no-cache' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  return await r.json()
}

function baseUrl(){
  return process.env.URL || process.env.DEPLOY_PRIME_URL || ''
}

function pickLang(bucket){
  if (!bucket) return null
  const lang = 'en'
  return bucket[lang] || bucket.ko || bucket.zh || null
}

export async function handler(){
  try{
    const base = baseUrl()
    if (!base) throw new Error('Base URL unavailable')
    const psomUrl = `${base.replace(/\/+$/,'')}/assets/hero/psom.json`
    const psom = await fetchJSON(psomUrl)
    const out = {}

    // socialnetwork: grid + rightPanel
    if (psom.socialnetwork && psom.socialnetwork.grid){
      out.socialnetwork = {
        grid: Array.isArray(psom.socialnetwork.grid.sections) ?
          psom.socialnetwork.grid.sections.map(s => ({
            id: s.id, title: s.title, items: (s.geo && (s.geo._default || [])) || []
          })) : [],
        rightPanel: psom.socialnetwork.rightPanel ? {
          title: psom.socialnetwork.rightPanel.title,
          type: psom.socialnetwork.rightPanel.type,
          items: (psom.socialnetwork.rightPanel.geo && (psom.socialnetwork.rightPanel.geo._default || [])) || []
        } : null
      }
    }

    // tour / networkhub: rightPanel only
    for (const key of ['tour','networkhub']) {
      const p = psom[key]
      if (p && p.rightPanel) {
        out[key] = { rightPanel: {
          title: p.rightPanel.title,
          type: p.rightPanel.type,
          items: (p.rightPanel.geo && (p.rightPanel.geo._default || [])) || []
        } }
      }
    }

    // mediahub: grid sections only (no right panel)
    if (psom.mediahub && psom.mediahub.grid){
      out.mediahub = {
        grid: Array.isArray(psom.mediahub.grid.sections) ?
          psom.mediahub.grid.sections.map(s => ({ id:s.id, title:s.title, items: (s.geo && (s.geo._default||[])) || [] })) : []
      }
    }

    // donation: grid sections only (no right panel, region neutral)
    if (psom.donation && psom.donation.grid){
      out.donation = {
        grid: Array.isArray(psom.donation.grid.sections) ?
          psom.donation.grid.sections.map(s => ({ id:s.id, title:s.title, items: (s.geo && (s.geo._default||[])) || [] })) : []
      }
    }

    // home / distributionhub: passthrough (store as data)
    for (const key of ['home','distributionhub']) {
      if (psom[key]) {
        out[key] = { data: psom[key] }
      }
    }

    out.updatedAt = new Date().toISOString()

    const store = getStore(FEED_NS)
    await store.set(FEED_KEY, JSON.stringify(out))
    return { statusCode: 200, body: 'OK' }
  } catch (e) {
    return { statusCode: 500, body: String(e) }
  }
}
