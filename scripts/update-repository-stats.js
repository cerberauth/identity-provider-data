// Refreshes stars, contributors, latestVersion and lastRelease for every GitHub repository
// listed in providers/*.json. Set GITHUB_TOKEN to avoid the unauthenticated rate limit.
const fs = require('node:fs')
const path = require('node:path')

const providersDir = path.resolve(__dirname, '..', 'providers')
const today = new Date().toISOString().slice(0, 10)

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'identity-provider-data' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

async function github(apiPath) {
  const response = await fetch(`https://api.github.com${apiPath}`, { headers })
  if (response.status === 404) return { response, body: null }
  if (!response.ok) throw new Error(`GitHub API ${apiPath} failed: ${response.status} ${response.statusText}`)
  return { response, body: await response.json() }
}

// With per_page=1 the last page number of the Link header is the total count.
async function countContributors(slug) {
  const { response, body } = await github(`/repos/${slug}/contributors?per_page=1&anon=true`)
  const last = /[?&]page=(\d+)>; rel="last"/.exec(response.headers.get('link') ?? '')
  return last ? Number(last[1]) : (body?.length ?? 0)
}

async function fetchStats(slug) {
  const { body: repo } = await github(`/repos/${slug}`)
  if (!repo) throw new Error(`Repository not found: ${slug}`)
  const { body: release } = await github(`/repos/${slug}/releases/latest`)
  return {
    stars: repo.stargazers_count,
    contributors: await countContributors(slug),
    ...(release ? { latestVersion: release.tag_name, lastRelease: release.published_at.slice(0, 10) } : {}),
    statsUpdatedAt: today,
  }
}

async function main() {
  let failed = false
  for (const file of fs.readdirSync(providersDir).filter((name) => name.endsWith('.json'))) {
    const filePath = path.join(providersDir, file)
    const provider = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!provider.repositories) continue

    for (const [index, repository] of provider.repositories.entries()) {
      if (repository.platform !== 'github') continue
      const slug = new URL(repository.url).pathname.slice(1)
      try {
        const { url, platform, role } = repository
        provider.repositories[index] = { url, platform, role, ...(await fetchStats(slug)) }
        console.log(`Updated ${slug}`)
      } catch (err) {
        failed = true
        console.error(`Failed ${slug}: ${err.message}`)
      }
    }
    fs.writeFileSync(filePath, `${JSON.stringify(provider, null, 2)}\n`)
  }
  if (failed) process.exit(1)
}

main()
