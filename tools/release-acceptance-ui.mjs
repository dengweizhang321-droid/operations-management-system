// A request audit for real UI acceptance. Exact candidate resource inventory,
// precise blocked-icon exception, and an explicit reviewed business GET list.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { safeRead } from './release-impact.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = value => typeof value === 'string' && /^\/[A-Za-z0-9_./-]*$/.test(value)
  && !value.includes('..') && !value.includes('//');
export function requestPolicy({ origin, resources, readPaths = [] }) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Exact HTTP loopback origin required');
  if (!resources || Object.entries(resources).some(([uri, digest]) => !safePath(uri) || !/^[a-f0-9]{64}$/.test(digest))
    || readPaths.some(uri => !safePath(uri) || !uri.startsWith('/api/'))) throw new Error('Invalid reviewed resource/read inventory');
  return request => {
    let url; try { url = new URL(request.url); } catch { return { action: 'abort', kind: 'illegal-url' }; }
    if (request.method !== 'GET') return { action: 'abort', kind: 'business-write' };
    if (url.username || url.password || url.hash || !safePath(url.pathname)) return { action: 'abort', kind: 'illegal-url' };
    if (url.protocol === 'https:' && url.hostname === base.hostname && url.port === base.port
      && url.pathname === '/favicon.svg' && !url.search && ['other', 'image'].includes(request.resourceType)
      && resources['/favicon.svg']) return { action: 'abort', kind: 'blocked-nonbusiness-icon' };
    if (url.origin !== base.origin) return { action: 'abort', kind: 'illegal-external' };
    if (Object.hasOwn(resources, url.pathname) && !url.search) return { action: 'continue', kind: 'candidate-static', pathname: url.pathname };
    if (url.pathname === '/' || readPaths.includes(url.pathname)) return { action: 'continue', kind: 'reviewed-read' };
    return { action: 'abort', kind: 'unapproved-resource' };
  };
}
export async function installUiRequestAudit(context, config) {
  const classify = requestPolicy(config), attempts = [], resourceEvidence = [], pending = new Set(), failures = [];
  await context.route('**/*', async route => {
    const request = route.request(), decision = classify({ url: request.url(), method: request.method(), resourceType: request.resourceType() });
    attempts.push({ method: request.method(), resourceType: request.resourceType(), ...decision });
    if (decision.action === 'abort') await route.abort(); else await route.continue();
  });
  context.on('response', response => {
    const request = response.request(), decision = classify({ url: request.url(), method: request.method(), resourceType: request.resourceType() });
    if(decision.kind==='reviewed-read'&&response.status()!==200)failures.push({code:'REVIEWED_READ_HTTP_FAILURE',status:response.status()});
    if (decision.kind !== 'candidate-static') return;
    const task = (async () => {
      const bytes = await response.body(), digest = sha(bytes);
      if (response.status() !== 200 || digest !== config.resources[decision.pathname]) throw new Error('Candidate resource does not match');
      resourceEvidence.push({ pathname: decision.pathname, sha256: digest, bytes: bytes.length, status: 200 });
    })().catch(() => failures.push({ pathname: decision.pathname, code: 'RESOURCE_MISMATCH_OR_UNAVAILABLE' })).finally(() => pending.delete(task));
    pending.add(task);
  });
  context.on('requestfailed', request => {
    const decision = classify({ url: request.url(), method: request.method(), resourceType: request.resourceType() });
    if (decision.action === 'continue') failures.push({ pathname: decision.pathname ?? null, code: 'EXPECTED_REQUEST_FAILED' });
  });
  return { attempts, resourceEvidence, async finish() {
    await Promise.all([...pending]);
    if (attempts.some(record => record.kind === 'blocked-nonbusiness-icon') && !resourceEvidence.some(record => record.pathname === '/favicon.svg')) {
      try {
        const response = await context.request.get(`${config.origin}/favicon.svg`, { maxRedirects: 0, timeout: 20_000 });
        const bytes = await response.body(), digest = sha(bytes);
        if (response.status() !== 200 || digest !== config.resources['/favicon.svg']) throw new Error();
        resourceEvidence.push({ pathname: '/favicon.svg', sha256: digest, bytes: bytes.length, status: 200, observation: 'independent-http-icon-check' });
      } catch { failures.push({ pathname: '/favicon.svg', code: 'HTTP_ICON_MISMATCH_OR_UNAVAILABLE' }); }
    }
    const dangerous = attempts.filter(record => record.action === 'abort' && record.kind !== 'blocked-nonbusiness-icon');
    const missing = (config.requiredResources ?? Object.keys(config.resources)).filter(uri => !resourceEvidence.some(record => record.pathname === uri));
    // A blocked icon is acceptable only with the normal HTTP candidate bytes
    // independently loaded/checked. Blocking cannot prove normal display.
    if (attempts.some(record => record.kind === 'blocked-nonbusiness-icon') && !resourceEvidence.some(record => record.pathname === '/favicon.svg')) missing.push('/favicon.svg');
    return { status: dangerous.length || failures.length || missing.length ? 'failed' : 'passed',
      productionWrites: 0, blockedIcons: attempts.filter(record => record.kind === 'blocked-nonbusiness-icon').length,
      attemptedBusinessWrites: attempts.filter(record => record.kind === 'business-write').length,
      attempts, resourceEvidence, dangerous, failures, missing: [...new Set(missing)] };
  } };
}
export async function candidateResourceInventory(clientRoot, paths) {
  const resources = {};
  for (const uri of paths) {
    if (!safePath(uri)) throw new Error('Unsafe candidate resource path');
    resources[uri] = sha(await safeRead(path.join(clientRoot, uri.slice(1))));
  }
  return resources;
}
export async function exerciseCustomerImportUi(page, { origin, shops, from, to }) {
  if (shops.length !== 4 || new Set(shops).size !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Exact four-shop/date witness required');
  const entries = [`/?module=customer_service&period=custom&from=${from}&to=${to}`, '/?module=import&source=customer_service'];
  for (const [index, url] of entries.entries()) {
    await page.goto(origin + url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const select = page.getByRole('button', { name: '客服导入店铺', exact: true });
    await select.waitFor({ timeout: 60_000 });
    if (!(await select.innerText()).includes('请选择店铺') || !await page.getByRole('button', { name: '开始导入并匹配', exact: true }).isDisabled()) throw new Error('Initial import permission/file guard failed');
    await select.click();
    if (JSON.stringify(await page.getByRole('option').allTextContents()) !== JSON.stringify(shops)) throw new Error('Four-shop identity/order changed');
    for (const [i, shop] of shops.entries()) {
      if (i > 0) await select.click();
      await page.getByRole('option', { name: shop, exact: true }).click();
      if (!(await select.innerText()).includes(shop) || !await page.getByRole('button', { name: '开始导入并匹配', exact: true }).isDisabled()) throw new Error('Selected shop/file guard failed');
    }
    if (index === 0) await page.getByText('会话店铺筛选', { exact: true }).waitFor();
  }
  return { fourShopProductionUi: true, entrypoints: entries.length, selections: 8 };
}
