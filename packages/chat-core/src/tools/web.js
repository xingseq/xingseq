/**
 * chat-app 联网工具组
 *
 * 提供两个工具：
 *   - web_search: 联网搜索（优先 Tavily，无 key 自动降级 Bing）
 *   - web_fetch:  抓取 URL 正文（HTML 自动剥标签，限制大小 + SSRF 防护）
 *
 * 设计要点：
 *   - 不依赖第三方解析库，零额外 npm 依赖
 *   - Node 18+ 原生 fetch + AbortController
 *   - web_fetch 拒绝 localhost / 私有 IP 段，防止误访问内网
 *   - 返回结构统一：成功直接返回数据，失败抛 Error（由 tool-registry 包装）
 *
 * Tavily key 通过 config-core 的 getTavilyApiKey() 读取，
 * 存储位置：<userData>/config/general.json -> tavilyApiKey
 */

import dns from 'node:dns/promises'
import { getTavilyApiKey } from '@xingseq/config-core'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('WebTools')

const MAX_FETCH_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 15000
const DEFAULT_UA = 'Mozilla/5.0 (compatible; xingseq-chat-app/0.1)'

// ── 工具定义（OpenAI Function Calling）────────────────────────────────────────

export const webSearchTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '在互联网上搜索实时信息。当用户询问需要最新数据、时事新闻、不确定的事实等内容时使用。搜索源由系统自动选择（优先 Tavily，无 key 时降级 Bing）。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，应简洁明确，突出核心信息'
        },
        max_results: {
          type: 'number',
          description: '最大返回结果数，默认 5，上限 10'
        }
      },
      required: ['query']
    }
  }
}

export const webFetchTool = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description: '抓取指定 URL 的网页内容并返回纯文本（HTML 会自动剥除标签）。用于深入阅读 web_search 返回的某个链接，或用户直接给出的 URL。仅支持 http/https，禁止访问内网地址。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要抓取的完整 URL（必须以 http:// 或 https:// 开头）'
        },
        max_chars: {
          type: 'number',
          description: '返回正文最大字符数，默认 4000，上限 16000'
        }
      },
      required: ['url']
    }
  }
}

export const WEB_TOOLS = [webSearchTool, webFetchTool]

// ── SSRF 防护 ────────────────────────────────────────────────────────────────

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false
  const [a, b] = parts
  if (a === 0) return true                       // 0.0.0.0/8
  if (a === 10) return true                      // 10.0.0.0/8
  if (a === 127) return true                     // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true        // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true        // 192.168.0.0/16
  if (a >= 224) return true                      // 224+ 组播/保留
  return false
}

function isPrivateIPv6(ip) {
  const s = ip.toLowerCase().split('%')[0]       // 去掉 zone id
  if (s === '::1') return true
  if (s === '::') return true
  if (s.startsWith('fe80:') || s.startsWith('fe80::')) return true // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true        // ULA
  if (s.startsWith('::ffff:')) {                                   // IPv4-mapped
    const v4 = s.slice(7)
    return isPrivateIPv4(v4)
  }
  return false
}

async function assertSafeUrl(rawUrl) {
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error(`非法 URL: ${rawUrl}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`仅支持 http/https，拒绝: ${u.protocol}`)
  }
  const host = u.hostname
  if (!host) throw new Error('URL 缺少 host')

  // 字面 IP 直接判
  if (/^[\d.]+$/.test(host) && isPrivateIPv4(host)) {
    throw new Error(`拒绝访问私有/保留地址: ${host}`)
  }
  if (host.includes(':') && isPrivateIPv6(host)) {
    throw new Error(`拒绝访问私有/保留地址: ${host}`)
  }
  if (host === 'localhost') {
    throw new Error(`拒绝访问 localhost`)
  }

  // 域名解析后再判
  try {
    const records = await dns.lookup(host, { all: true })
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) {
        throw new Error(`拒绝访问私有地址: ${host} → ${r.address}`)
      }
      if (r.family === 6 && isPrivateIPv6(r.address)) {
        throw new Error(`拒绝访问私有地址: ${host} → ${r.address}`)
      }
    }
  } catch (err) {
    if (err.message.startsWith('拒绝')) throw err
    throw new Error(`DNS 解析失败: ${host} (${err.message})`)
  }
  return u
}

// ── HTML 转文本（极简）───────────────────────────────────────────────────────

function htmlToText(html) {
  let title = ''
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (m) title = decodeEntities(m[1].trim()).slice(0, 200)

  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  text = decodeEntities(text)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title, text }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

// ── 安全 fetch（带超时 + 大小限制）──────────────────────────────────────────

async function safeFetch(url, { method = 'GET', headers, body } = {}) {
  const u = await assertSafeUrl(url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('fetch 超时')), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(u, {
      method,
      headers: { 'User-Agent': DEFAULT_UA, ...(headers || {}) },
      body,
      signal: ctrl.signal,
      redirect: 'follow'
    })
    if (!res.ok) {
      // 仍读一小段方便调试
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    // 流式读取，超过 MAX_FETCH_BYTES 立即中止
    const reader = res.body.getReader()
    const chunks = []
    let total = 0
    let truncated = false
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_FETCH_BYTES) {
        chunks.push(value.slice(0, value.byteLength - (total - MAX_FETCH_BYTES)))
        truncated = true
        try { await reader.cancel() } catch {}
        break
      }
      chunks.push(value)
    }
    const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
    const ct = res.headers.get('content-type') || ''
    const text = buf.toString('utf-8')
    return { status: res.status, contentType: ct, text, truncated, finalUrl: res.url }
  } finally {
    clearTimeout(timer)
  }
}

// ── 搜索源：Tavily ──────────────────────────────────────────────────────────

async function searchByTavily({ apiKey, query, maxResults }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('Tavily 超时')), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DEFAULT_UA
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.min(Math.max(1, maxResults), 10),
        include_answer: false,
        search_depth: 'basic'
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`Tavily HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    const json = await res.json()
    const results = Array.isArray(json.results) ? json.results : []
    return results.map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: (r.content || '').slice(0, 500)
    }))
  } finally {
    clearTimeout(timer)
  }
}

// ── 搜索源：Bing（免费降级，国内可访问） ───────────────────────────────────────

async function searchByBing({ query, maxResults }) {
  const u = `https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`
  const { text } = await safeFetch(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  })
  const out = []
  const blockRe = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  let bm
  while ((bm = blockRe.exec(text)) && out.length < maxResults) {
    const block = bm[1]
    const titleM = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleM) continue
    const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    out.push({
      title: decodeEntities(titleM[2].replace(/<[^>]+>/g, '').trim()).slice(0, 200),
      url: titleM[1],
      snippet: snippetM
        ? decodeEntities(snippetM[1].replace(/<[^>]+>/g, '').trim()).slice(0, 500)
        : ''
    })
  }
  return out
}

// ── Handlers ────────────────────────────────────────────────────────────────

export function createWebHandlers(opts = {}) {
  // 允许测试时注入 mock
  const _getTavilyKey = opts.getTavilyKey || getTavilyApiKey

  return {
    web_search: async (args = {}) => {
      const query = (args.query || '').trim()
      if (!query) throw new Error('参数 query 必填')
      const maxResults = Math.min(Math.max(1, args.max_results || 5), 10)

      const tavilyKey = (await _getTavilyKey().catch(() => '')) || ''
      let source = 'bing'
      let results = []
      let fallbackReason = null

      if (tavilyKey) {
        try {
          results = await searchByTavily({ apiKey: tavilyKey, query, maxResults })
          source = 'tavily'
        } catch (err) {
          logger.warn(`Tavily 失败，降级 Bing: ${err.message}`)
          fallbackReason = `tavily: ${err.message}`
        }
      }

      if (source !== 'tavily') {
        try {
          results = await searchByBing({ query, maxResults })
        } catch (err) {
          throw new Error(`搜索失败: ${err.message}${fallbackReason ? ` (${fallbackReason})` : ''}`)
        }
      }

      if (results.length === 0) {
        return { source, query, results: [], note: '搜索返回 0 条结果' }
      }
      return { source, query, results }
    },

    web_fetch: async (args = {}) => {
      const url = (args.url || '').trim()
      if (!url) throw new Error('参数 url 必填')
      const maxChars = Math.min(Math.max(100, args.max_chars || 4000), 16000)

      const { contentType, text, truncated, finalUrl } = await safeFetch(url)
      const isHtml = /text\/html|application\/xhtml/i.test(contentType)
      let title = ''
      let body = text

      if (isHtml) {
        const parsed = htmlToText(text)
        title = parsed.title
        body = parsed.text
      }

      const overflow = body.length > maxChars
      if (overflow) body = body.slice(0, maxChars)

      return {
        url: finalUrl || url,
        contentType,
        title,
        content: body,
        truncated: truncated || overflow,
        originalLength: text.length
      }
    }
  }
}
