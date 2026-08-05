const WECHAT_CODE_ENDPOINT = 'https://api.weixin.qq.com/sns/jscode2session';
const WECHAT_ACCESS_TOKEN_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/token';
const WECHAT_MINI_CODE_ENDPOINT = 'https://api.weixin.qq.com/wxa/getwxacodeunlimit';
const WECHAT_INVALID_CODE_ERRORS = new Set([40029, 40163]);

class WechatAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class WechatMiniCodeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createWechatAuth({ env = process.env, fetchImpl = globalThis.fetch, logger = { warn() {} } } = {}) {
  const appId = env.WX_MINIPROGRAM_APP_ID;
  const appSecret = env.WX_MINIPROGRAM_APP_SECRET;

  return async function authenticateWechatCode(code) {
    if (!appId || !appSecret) throw new WechatAuthError('WECHAT_LOGIN_UNCONFIGURED', '真实微信登录尚未配置，无法完成身份认证');
    if (typeof fetchImpl !== 'function') throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务不可用');

    let response;
    try {
      const url = new URL(WECHAT_CODE_ENDPOINT);
      url.searchParams.set('appid', appId);
      url.searchParams.set('secret', appSecret);
      url.searchParams.set('js_code', code);
      url.searchParams.set('grant_type', 'authorization_code');
      response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    } catch (error) {
      logger.warn({ stage: 'jscode2session_request', errorName: error && error.name }, '[wechat-auth-upstream]');
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务暂不可用');
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      logger.warn({ stage: 'jscode2session_response', errorName: error && error.name, httpStatus: response && response.status }, '[wechat-auth-upstream]');
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务返回异常');
    }
    if (!response.ok) {
      logger.warn({ stage: 'jscode2session_http', httpStatus: response.status }, '[wechat-auth-upstream]');
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务暂不可用');
    }
    // Only WeChat's explicit invalid or already-used js_code responses are retryable client failures.
    if (payload && WECHAT_INVALID_CODE_ERRORS.has(payload.errcode)) {
      throw new WechatAuthError('WECHAT_CODE_INVALID', '微信登录凭据无效或已过期，请重试');
    }
    if (payload && payload.errcode) {
      logger.warn({ stage: 'jscode2session_payload', wechatErrorCode: payload.errcode }, '[wechat-auth-upstream]');
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务暂不可用');
    }
    if (!payload || typeof payload.openid !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(payload.openid)) {
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验结果无效');
    }
    return { openid: payload.openid };
  };
}

function createWechatMiniCode({ env = process.env, fetchImpl = globalThis.fetch, logger = { warn() {} } } = {}) {
  const appId = env.WX_MINIPROGRAM_APP_ID;
  const appSecret = env.WX_MINIPROGRAM_APP_SECRET;
  let cachedToken = null;

  async function requestJson(url, options) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(5000) });
    } catch (_error) {
      throw new WechatMiniCodeError('WECHAT_MINI_CODE_UNAVAILABLE', '微信小程序码服务暂不可用');
    }
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new WechatMiniCodeError('WECHAT_MINI_CODE_UNAVAILABLE', '微信小程序码服务返回异常');
    }
    if (!response.ok || !payload || payload.errcode || typeof payload.access_token !== 'string') {
      throw new WechatMiniCodeError('WECHAT_MINI_CODE_UNAVAILABLE', '微信小程序码服务暂不可用');
    }
    return payload;
  }

  async function accessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
    const url = new URL(WECHAT_ACCESS_TOKEN_ENDPOINT);
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);
    const payload = await requestJson(url, { method: 'GET' });
    const validForSeconds = Math.max(60, (Number(payload.expires_in) || 7200) - 60);
    cachedToken = { value: payload.access_token, expiresAt: Date.now() + validForSeconds * 1000 };
    return cachedToken.value;
  }

  return async function generateMiniCode({ scene, page = 'pages/invite/index' }) {
    if (!appId || !appSecret) throw new WechatMiniCodeError('WECHAT_LOGIN_UNCONFIGURED', '真实微信登录尚未配置，无法生成小程序码');
    if (typeof fetchImpl !== 'function') throw new WechatMiniCodeError('WECHAT_MINI_CODE_UNAVAILABLE', '微信小程序码服务不可用');
    const token = await accessToken();
    let response;
    try {
      response = await fetchImpl(`${WECHAT_MINI_CODE_ENDPOINT}?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scene, page, check_path: true }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (_error) {
      throw new WechatMiniCodeError('WECHAT_MINI_CODE_UNAVAILABLE', '微信小程序码服务暂不可用');
    }
    let buffer;
    try {
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (_error) {
      throw new WechatMiniCodeError('WECHAT_MINI_CODE_UNAVAILABLE', '微信小程序码服务返回异常');
    }
    const contentType = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : '';
    if (!response.ok || !contentType || !contentType.startsWith('image/')) {
      throw new WechatMiniCodeError('WECHAT_MINI_CODE_UNAVAILABLE', '微信小程序码服务暂不可用');
    }
    return { buffer, contentType };
  };
}

module.exports = { createWechatAuth, WechatAuthError, createWechatMiniCode, WechatMiniCodeError };
