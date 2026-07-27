const WECHAT_CODE_ENDPOINT = 'https://api.weixin.qq.com/sns/jscode2session';
const WECHAT_INVALID_CODE_ERRORS = new Set([40029, 40163]);

class WechatAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createWechatAuth({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
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
    } catch (_error) {
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务暂不可用');
    }

    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务返回异常');
    }
    if (!response.ok) throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务暂不可用');
    // Only WeChat's explicit invalid or already-used js_code responses are retryable client failures.
    if (payload && WECHAT_INVALID_CODE_ERRORS.has(payload.errcode)) {
      throw new WechatAuthError('WECHAT_CODE_INVALID', '微信登录凭据无效或已过期，请重试');
    }
    if (payload && payload.errcode) throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验服务暂不可用');
    if (!payload || typeof payload.openid !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(payload.openid)) {
      throw new WechatAuthError('WECHAT_AUTH_UNAVAILABLE', '微信身份校验结果无效');
    }
    return { openid: payload.openid };
  };
}

module.exports = { createWechatAuth, WechatAuthError };
