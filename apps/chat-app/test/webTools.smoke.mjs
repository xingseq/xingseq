/**
 * webTools.js handler 本地烟雾测试（不走 LLM）
 *
 * 覆盖：
 *   1. web_fetch 抓真实 https 页面 + HTML 转文本
 *   2. web_fetch SSRF 防护：localhost / 127.0.0.1 / 私有 IP 应被拒
 *   3. web_fetch 非法 protocol（ftp://）应被拒
 *   4. web_search 在 Tavily 无 key 时降级 DDG（如能联网）
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import path from 'node:path'
import os from 'node:os'
import { createWebHandlers } from '../src/webTools.js'

// shared env 注入（webTools 不直接用，但 getTavilyApiKey 依赖 userData）
setSharedEnv({
  getApp: () => ({
    getPath: () => path.join(os.homedir(), '.xingseq', 'chat-app')
  })
})

let pass = 0
let fail = 0
function ok(name) { pass++; console.log(`  ✓ ${name}`) }
function bad(name, err) { fail++; console.error(`  ✗ ${name}: ${err?.message || err}`) }

// 用 mock 模拟「没配 Tavily key」走 DDG 分支
const handlers = createWebHandlers({ getTavilyKey: async () => '' })

async function testSsrfBlock() {
  console.log('\n[SSRF 防护]')
  const bad_urls = [
    'http://localhost/',
    'http://127.0.0.1:3001/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'not a url'
  ]
  for (const u of bad_urls) {
    try {
      await handlers.web_fetch({ url: u })
      bad(`应拒绝 ${u}`, 'handler 返回成功')
    } catch (e) {
      ok(`拒绝 ${u} (${e.message.slice(0, 60)})`)
    }
  }
}

async function testWebFetch() {
  console.log('\n[web_fetch 真实抓取]')
  try {
    const r = await handlers.web_fetch({
      url: 'https://example.com/',
      max_chars: 1000
    })
    if (!r.content || r.content.length === 0) {
      return bad('example.com', '空内容')
    }
    if (!/Example Domain/i.test(r.content)) {
      return bad('example.com', `内容不含 Example Domain: ${r.content.slice(0, 100)}`)
    }
    console.log(`    title="${r.title}" len=${r.content.length} truncated=${r.truncated}`)
    ok(`抓取 example.com 成功`)
  } catch (e) {
    bad('example.com', e)
  }
}

async function testWebSearch() {
  console.log('\n[web_search 走 Bing 分支]')
  try {
    const r = await handlers.web_search({
      query: 'github copilot',
      max_results: 3
    })
    console.log(`    source=${r.source} results=${r.results.length}`)
    if (r.results.length > 0) {
      console.log(`    第一条: ${r.results[0].title} - ${r.results[0].url.slice(0, 80)}`)
    }
    if (r.source !== 'bing') return bad('search source', `期望 bing, 实际 ${r.source}`)
    if (r.results.length === 0) return bad('search 结果', '0 条（Bing 可能反爬或网络问题）')
    ok(`Bing 搜索返回 ${r.results.length} 条`)
  } catch (e) {
    bad('web_search', e)
  }
}

async function main() {
  console.log('=== webTools handler 本地烟雾测试 ===')
  await testSsrfBlock()
  await testWebFetch()
  await testWebSearch()
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})
