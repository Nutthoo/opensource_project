const crypto = require('crypto');
const { chromium } = require('playwright-core');

const SECRET_KEY = crypto
  .createHash('sha256')
  .update(`site-monitor-local-${process.env.USERNAME || 'user'}-${process.env.COMPUTERNAME || 'pc'}`)
  .digest();

function encryptCredentials(creds) {
  if (!creds) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
  let encrypted = cipher.update(JSON.stringify(creds), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptCredentials(raw) {
  if (!raw) return null;
  try {
    const [ivHex, encrypted] = raw.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

const activeBrowsers = new Map();

async function launchBrowser() {
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({
        channel,
        headless: false,
        args: ['--start-maximized'],
      });
    } catch {
      // 다음 브라우저 시도
    }
  }
  throw new Error('PC에 Chrome 또는 Microsoft Edge 브라우저가 설치되어 있어야 자동 로그인을 사용할 수 있습니다.');
}

// 메인 페이지와 모든 iframe 중 실제로 화면에 보이는 첫 번째 입력창 찾기
async function findVisibleLocator(page, selector) {
  for (const frame of page.frames()) {
    try {
      const loc = frame.locator(selector);
      const count = await loc.count();
      for (let i = 0; i < count; i++) {
        const nth = loc.nth(i);
        if (await nth.isVisible()) {
          return { frame, locator: nth };
        }
      }
    } catch {
      // 접근 불가 프레임 무시
    }
  }
  return null;
}

// 메인 페이지에서 화면에 보이는 '로그인' 링크/버튼 찾아 클릭 (새 탭 전환 포함)
async function tryOpenLoginPage(context, page) {
  const triggerSelector = [
    'a:has-text("로그인")',
    'button:has-text("로그인")',
    'a:has-text("Login")',
    'button:has-text("Login")',
    'a:has-text("LOG IN")',
    'a:has-text("Sign in")',
    'button:has-text("Sign in")',
    'a[href*="login" i]',
    'a[href*="signin" i]',
    'a[href*="nidlogin" i]',
  ].join(', ');

  const found = await findVisibleLocator(page, triggerSelector);
  if (!found) return page;

  // 새 탭이 열릴 경우를 대비해 팝업 이벤트 동시 감지
  const popupPromise = context.waitForEvent('page', { timeout: 2500 }).catch(() => null);
  await found.locator.click({ timeout: 3000 }).catch(() => {});

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    return popup;
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

async function performAutoLogin(site, credentials) {
  if (!credentials?.username || !credentials?.password) {
    throw new Error('자동 로그인 아이디와 비밀번호가 설정되어 있지 않습니다.');
  }

  await closeAutoLogin(site.id);

  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: null });
  let page = await context.newPage();

  page.setDefaultTimeout(0);
  page.setDefaultNavigationTimeout(0);

  browser.on('disconnected', () => {
    activeBrowsers.delete(site.id);
  });
  activeBrowsers.set(site.id, browser);

  try {
    const targetUrl = credentials.loginUrl?.trim() || site.url;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 0 });
    await page.waitForTimeout(1000);

    const userSel =
      credentials.userSelector?.trim() ||
      'input[type="email"], input[name*="id" i], input[name*="user" i], input[id*="id" i], input[id*="user" i], input[placeholder*="아이디" i], input[placeholder*="이메일" i], input[type="text"]';
    const passSel =
      credentials.passSelector?.trim() ||
      'input[type="password"], input[placeholder*="비밀번호" i]';
    const submitSel =
      credentials.submitSelector?.trim() ||
      'button[type="submit"], input[type="submit"], button:has-text("로그인"), button:has-text("Login"), button:has-text("Sign in")';

    // 1. 현재 화면에 비밀번호 칸이 보이지 않으면 로그인 버튼 자동 클릭 시도
    let passFound = await findVisibleLocator(page, passSel);
    if (!passFound) {
      page = await tryOpenLoginPage(context, page);
      await page.waitForTimeout(1000);
    }

    // 2. 사용자가 직접 로그인 페이지로 이동할 수도 있으므로, 보이는 아이디/비밀번호 칸이 나올 때까지 타임아웃 없이 폴링 대기
    let userFound = null;
    passFound = null;

    while (browser.isConnected()) {
      // 사용자가 새 탭을 열었으면 최신 탭으로 추적 전환
      const pages = context.pages();
      if (pages.length > 0 && pages[pages.length - 1] !== page) {
        page = pages[pages.length - 1];
      }

      userFound = await findVisibleLocator(page, userSel);
      passFound = await findVisibleLocator(page, passSel);

      if (passFound || userFound) break;
      await page.waitForTimeout(500);
    }

    if (!browser.isConnected()) {
      return { success: false, error: '사용자가 브라우저 창을 닫았습니다.' };
    }

    // 3. 아이디 칸이 보이면 먼저 입력
    if (userFound) {
      await userFound.locator.click().catch(() => {});
      await userFound.locator.fill(credentials.username);
    }

    // 4. 비밀번호 칸이 아직 안 보이면(아이디 입력 후 다음 버튼 누르는 사이트) 잠깐 대기 후 다시 탐색
    if (!passFound) {
      const nextBtn = await findVisibleLocator(page, submitSel);
      if (nextBtn) await nextBtn.locator.click().catch(() => {});
      await page.waitForTimeout(800);
      passFound = await findVisibleLocator(page, passSel);
    }

    if (passFound) {
      await passFound.locator.click().catch(() => {});
      await passFound.locator.fill(credentials.password);

      const submitFound = await findVisibleLocator(page, submitSel);
      if (submitFound) {
        await submitFound.locator.click();
      } else {
        await passFound.locator.press('Enter');
      }
    }

    return { success: true };
  } catch (err) {
    if (!browser.isConnected()) {
      return { success: false, error: '사용자가 브라우저 창을 닫았습니다.' };
    }
    throw new Error(`자동 로그인 처리 중 오류: ${err.message}`);
  }
}

async function closeAutoLogin(siteId) {
  const numId = Number(siteId);
  const browser = activeBrowsers.get(numId);
  if (browser) {
    activeBrowsers.delete(numId);
    await browser.close().catch(() => {});
  }
}

module.exports = {
  encryptCredentials,
  decryptCredentials,
  performAutoLogin,
  closeAutoLogin,
};