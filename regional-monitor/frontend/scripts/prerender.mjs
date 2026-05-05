#!/usr/bin/env node
/**
 * 빌드 후처리 prerender 스크립트.
 *
 * 작동 원리:
 *   1. dist/ 를 정적 서버(express-like; 여기서는 자체 http server)로 띄움
 *   2. puppeteer 헤드리스 Chrome 으로 각 SEO 라우트 접속
 *   3. React Helmet 이 페이지별 <title>/<meta>/<link rel="canonical"> 등 주입 완료까지 대기
 *   4. 렌더된 HTML 스냅샷을 dist/<route>/index.html 로 저장
 *   5. nginx try_files 가 SPA 라우팅보다 정적 파일을 우선 서빙하도록 함
 *
 * 결과: Googlebot/Bingbot 1차 인덱싱 패스에서 페이지별 차별화 SSR HTML 인식 →
 *      "duplicate content / no canonical" 색인 제외 문제 해소.
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist')
const PORT = 8765

// ─────────────────────────────────────────────────────────────
// SEO prerender 대상 라우트 (sitemap.xml 과 일치)
// ─────────────────────────────────────────────────────────────
const ROUTES = [
  '/',
  '/intro',
  '/intro/keyword-dna',
  '/intro/keyword-discover',
  '/intro/competition',
  '/intro/monitor',
  '/about/what-is',
  '/about/keyword-logic',
  '/about/exposure-management',
  '/about/essential-categories',
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// dist/ 정적 서버 (SPA fallback: 파일 없으면 index.html 반환)
function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = decodeURIComponent((req.url || '/').split('?')[0])
        let filePath = join(DIST, url === '/' ? 'index.html' : url)
        try {
          const s = await stat(filePath)
          if (s.isDirectory()) filePath = join(filePath, 'index.html')
        } catch {
          // SPA fallback
          filePath = join(DIST, 'index.html')
        }
        if (!existsSync(filePath)) {
          filePath = join(DIST, 'index.html')
        }
        const ext = extname(filePath).toLowerCase()
        const data = await readFile(filePath)
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        res.end(data)
      } catch (e) {
        res.writeHead(500)
        res.end(String(e))
      }
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

async function renderRoute(browser, route) {
  const page = await browser.newPage()
  // 빌드 환경 자원 절약 — 이미지/폰트/외부 스크립트 차단 (HTML 만 필요)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const t = req.resourceType()
    const url = req.url()
    if (
      t === 'image' ||
      t === 'media' ||
      t === 'font' ||
      // 외부 분석 스크립트(GA 등) 차단
      (t === 'script' && !url.startsWith(`http://127.0.0.1:${PORT}/`))
    ) {
      req.abort()
    } else {
      req.continue()
    }
  })

  // prerender 모드 플래그 — main.tsx 가 이를 읽고 React Helmet 주입 완료 후
  // 'prerender-ready' 이벤트를 발사함
  await page.evaluateOnNewDocument(() => {
    window.__PRERENDER_INJECTED = { prerender: true }
  })

  const url = `http://127.0.0.1:${PORT}${route}`
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })

  // Helmet 주입 완료 이벤트 대기 (최대 8초)
  try {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          if (document.readyState !== 'complete') {
            window.addEventListener('load', () => {
              setTimeout(resolve, 1500)
            })
          } else {
            // Helmet 이 다음 프레임에 head 를 갱신하므로 여유시간 확보
            setTimeout(resolve, 1500)
          }
        }),
    )
  } catch {
    /* no-op */
  }

  // 페이지 HTML 추출 — DOCTYPE + <html> 까지 완전한 형태로
  const html = await page.evaluate(() => {
    const doctype = '<!DOCTYPE html>\n'
    return doctype + document.documentElement.outerHTML
  })

  await page.close()
  return html
}

// dist/<route>/index.html 로 저장. 루트는 dist/index.html 덮어씀.
async function writeRouteHtml(route, html) {
  const outPath =
    route === '/' ? join(DIST, 'index.html') : join(DIST, route, 'index.html')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, html, 'utf-8')
  return outPath
}

async function main() {
  if (!existsSync(DIST)) {
    console.error(`[prerender] dist 폴더가 없습니다: ${DIST}`)
    process.exit(1)
  }
  console.log(`[prerender] 정적 서버 기동 (port ${PORT})…`)
  const server = await startServer()

  console.log('[prerender] puppeteer 실행 중…')
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  })

  const results = []
  try {
    for (const route of ROUTES) {
      const t0 = Date.now()
      try {
        const html = await renderRoute(browser, route)
        const out = await writeRouteHtml(route, html)
        const titleMatch = html.match(/<title>([^<]+)<\/title>/)
        const title = titleMatch ? titleMatch[1].slice(0, 60) : '(no title)'
        const dt = Date.now() - t0
        const size = Buffer.byteLength(html, 'utf-8')
        console.log(
          `  ✓ ${route.padEnd(32)} → ${size.toString().padStart(6)} B  (${dt}ms)  ${title}`,
        )
        results.push({ route, ok: true, size, title, ms: dt, out })
      } catch (e) {
        console.error(`  ✗ ${route} 실패:`, e.message)
        results.push({ route, ok: false, error: e.message })
      }
    }
  } finally {
    await browser.close()
    server.close()
  }

  const okCount = results.filter((r) => r.ok).length
  console.log(`\n[prerender] 완료: ${okCount}/${ROUTES.length} 라우트`)
  if (okCount !== ROUTES.length) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[prerender] 치명 오류:', e)
  process.exit(1)
})
