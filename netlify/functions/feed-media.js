// netlify/functions/feed-media.js
// IGDC Media Feed – Production Version

const SNAPSHOT_URL = "https://YOUR_DOMAIN/data/search-bank.snapshot.json"

const SECTION_CONFIG = {
  trending_now: { type: "trending", limit: 30 },
  latest_movie: { type: "movie", limit: 20 },
  latest_drama: { type: "drama", limit: 20 },
  section_1: { type: "thriller", limit: 20 },
  section_2: { type: "documentary", limit: 20 },
  section_3: { type: "music", limit: 20 },
  section_4: { type: "animation", limit: 20 },
  section_5: { type: "shortfilm", limit: 20 },
  section_6: { type: "interview", limit: 20 },
  section_7: { type: "feature", limit: 20 }
}

exports.handler = async (event) => {

  try {

    const section = event.queryStringParameters?.section || "trending_now"
    const config = SECTION_CONFIG[section]

    if (!config) {
      return response({ items: [] })
    }

    const snapshot = await loadSnapshot()

    let items = []

    if (config.type === "trending") {
      items = buildTrending(snapshot)
    } else {
      items = filterByType(snapshot, config.type)
    }

    items = normalize(items)
      .sort(sortLogic)
      .slice(0, config.limit)

    return response({
      section,
      count: items.length,
      items
    })

  } catch (err) {

    return response({
      error: "feed_media_error",
      message: err.message
    })

  }

}

async function loadSnapshot() {

  const res = await fetch(SNAPSHOT_URL)
  const data = await res.json()

  if (!data) return []

  return Array.isArray(data) ? data : data.items || []

}

function buildTrending(snapshot) {

  const now = Date.now()

  return snapshot.map(item => {

    const views = Number(item.views || 0)
    const likes = Number(item.likes || 0)
    const comments = Number(item.comments || 0)

    const published = new Date(item.published_at || item.date || 0).getTime()
    const hours = (now - published) / 3600000 || 1

    const score =
      (views * 0.6) +
      (likes * 3) +
      (comments * 4) -
      (hours * 0.1)

    return {
      ...item,
      trending_score: score
    }

  }).sort((a, b) => b.trending_score - a.trending_score)

}

function filterByType(snapshot, type) {

  return snapshot.filter(item => {

    const tags = item.tags || []
    const category = item.category || ""

    if (category === type) return true

    if (Array.isArray(tags) && tags.includes(type)) return true

    return false

  })

}

function normalize(items) {

  return items.map(item => {

    return {
      id: item.id || "",
      title: item.title || "",
      description: item.description || "",
      thumbnail: item.thumbnail || item.image || "",
      url: item.url || "",
      source: item.source || "",
      category: item.category || "",
      views: Number(item.views || 0),
      likes: Number(item.likes || 0),
      comments: Number(item.comments || 0),
      published_at: item.published_at || item.date || ""
    }

  })

}

function sortLogic(a, b) {

  const aViews = Number(a.views || 0)
  const bViews = Number(b.views || 0)

  return bViews - aViews

}

function response(data) {

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300"
    },
    body: JSON.stringify(data)
  }

}