const { createWechatAuth, createWechatMiniCode } = require('../src/wechat-auth');

describe('微信 code 校验 HTTP 请求', () => {
  it('以 GET 请求 jscode2session 并解析合法 openid', async () => {
    let captured;
    const authenticate = createWechatAuth({
      env: {
        WX_MINIPROGRAM_APP_ID: 'test-app-id',
        WX_MINIPROGRAM_APP_SECRET: 'test-app-secret',
      },
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return { ok: true, json: async () => ({ openid: 'fixture_openid_123456' }) };
      },
    });

    await expect(authenticate('test-login-code')).resolves.toEqual({ openid: 'fixture_openid_123456' });

    expect(captured.url).toBeInstanceOf(URL);
    expect(captured.url.origin + captured.url.pathname).toBe('https://api.weixin.qq.com/sns/jscode2session');
    expect(Object.fromEntries(captured.url.searchParams)).toEqual({
      appid: 'test-app-id',
      secret: 'test-app-secret',
      js_code: 'test-login-code',
      grant_type: 'authorization_code',
    });
    expect(captured.options).toMatchObject({ method: 'GET' });
  });

  it.each([40029, 40163])('微信返回 %i 时标记一次性 code 无效', async (errcode) => {
    const authenticate = createWechatAuth({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ errcode }) }),
    });

    await expect(authenticate('test-login-code')).rejects.toMatchObject({ code: 'WECHAT_CODE_INVALID' });
  });

  it('非 2xx 响应不伪装为登录成功', async () => {
    const authenticate = createWechatAuth({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async () => ({ ok: false, json: async () => ({ errcode: 50001 }) }),
    });

    await expect(authenticate('test-login-code')).rejects.toMatchObject({ code: 'WECHAT_AUTH_UNAVAILABLE' });
  });

  it('非 JSON 响应返回服务不可用', async () => {
    const authenticate = createWechatAuth({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid json'); } }),
    });

    await expect(authenticate('test-login-code')).rejects.toMatchObject({ code: 'WECHAT_AUTH_UNAVAILABLE' });
  });

  it.each(['network failure', 'timeout'])('请求发生 %s 时返回服务不可用', async (reason) => {
    const authenticate = createWechatAuth({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async () => { throw new Error(reason); },
    });

    await expect(authenticate('test-login-code')).rejects.toMatchObject({ code: 'WECHAT_AUTH_UNAVAILABLE' });
  });

  it.each([undefined, '', 'invalid openid'])('缺少或非法 openid 不建立身份', async (openid) => {
    const authenticate = createWechatAuth({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async () => ({ ok: true, json: async () => (openid === undefined ? {} : { openid }) }),
    });

    await expect(authenticate('test-login-code')).rejects.toMatchObject({ code: 'WECHAT_AUTH_UNAVAILABLE' });
  });

  it.each([
    { WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
    { WX_MINIPROGRAM_APP_ID: 'test-app-id' },
  ])('缺少必要环境变量时不发起微信请求', async (env) => {
    let calls = 0;
    const authenticate = createWechatAuth({
      env,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, json: async () => ({ openid: 'fixture_openid_123456' }) };
      },
    });

    await expect(authenticate('test-login-code')).rejects.toMatchObject({ code: 'WECHAT_LOGIN_UNCONFIGURED' });
    expect(calls).toBe(0);
  });
});

describe('微信小程序码 HTTP 请求', () => {
  it('获取 access token 后生成可扫描的小程序码，并在有效期内复用 token', async () => {
    const calls = [];
    const generateMiniCode = createWechatMiniCode({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (String(url).startsWith('https://api.weixin.qq.com/cgi-bin/token')) {
          return { ok: true, json: async () => ({ access_token: 'fixture-token', expires_in: 7200 }) };
        }
        return {
          ok: true,
          headers: { get: (name) => name === 'content-type' ? 'image/png' : null },
          arrayBuffer: async () => new TextEncoder().encode('mini-code-fixture').buffer,
        };
      },
    });

    await expect(generateMiniCode({ scene: 'inviteCode=MATHSTAT-2026-A' })).resolves.toMatchObject({ contentType: 'image/png' });
    await expect(generateMiniCode({ scene: 'inviteCode=MATHSTAT-2026-B' })).resolves.toMatchObject({ contentType: 'image/png' });

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBeInstanceOf(URL);
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ grant_type: 'client_credential', appid: 'test-app-id', secret: 'test-app-secret' });
    expect(calls[1].url).toBe('https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=fixture-token');
    expect(JSON.parse(calls[1].options.body)).toEqual({ scene: 'inviteCode=MATHSTAT-2026-A', page: 'pages/invite/index', check_path: true });
  });

  it('未配置凭据或微信未返回图片时不伪造小程序码', async () => {
    const unconfigured = createWechatMiniCode({ env: {}, fetchImpl: async () => { throw new Error('should not request'); } });
    await expect(unconfigured({ scene: 'inviteCode=ABCDEF' })).rejects.toMatchObject({ code: 'WECHAT_LOGIN_UNCONFIGURED' });

    const unavailable = createWechatMiniCode({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async (url) => String(url).startsWith('https://api.weixin.qq.com/cgi-bin/token')
        ? { ok: true, json: async () => ({ access_token: 'fixture-token', expires_in: 7200 }) }
        : { ok: true, headers: { get: () => 'application/json' }, arrayBuffer: async () => new TextEncoder().encode('{"errcode":41030}').buffer },
    });
    await expect(unavailable({ scene: 'inviteCode=ABCDEF' })).rejects.toMatchObject({ code: 'WECHAT_MINI_CODE_UNAVAILABLE' });
  });
});
