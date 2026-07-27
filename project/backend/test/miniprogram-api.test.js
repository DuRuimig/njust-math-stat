const apiModulePath = require.resolve('../../../miniprogram/utils/api');
const profilePagePath = require.resolve('../../../miniprogram/pages/profile/index');
const courseDetailPagePath = require.resolve('../../../miniprogram/pages/course-detail/index');
const teachingPagePath = require.resolve('../../../miniprogram/pages/teaching/index');

const originalWx = global.wx;
const originalGetApp = global.getApp;
const originalPage = global.Page;

function loadApi() {
  delete require.cache[apiModulePath];
  return require(apiModulePath);
}

function installCloudRuntime(handler, options = {}) {
  const hasInitialSession = Object.prototype.hasOwnProperty.call(options, 'initialSession');
  let storedSession = hasInitialSession ? options.initialSession : {
    token: 'local-test-session',
    mode: 'wechat',
    expiresAt: Date.now() + 60_000,
  };
  let removals = 0;
  const requests = [];
  const toasts = [];
  global.getApp = () => ({
    globalData: {
      apiMode: 'cloud',
      authMode: options.authMode || 'wechat',
      cloudEnvironmentId: 'test-environment',
      cloudContainerService: 'test-service',
    },
  });
  global.wx = {
    getStorageSync: () => storedSession,
    setStorageSync: (_key, value) => {
      if (options.setStorageError) throw options.setStorageError;
      if (!options.ignoreStorageWrite) storedSession = value;
    },
    removeStorageSync: () => {
      removals += 1;
      if (options.removeStorageError) throw options.removeStorageError;
      storedSession = null;
    },
    showToast: (toast) => { toasts.push(toast); },
    cloud: {
      callContainer: (options) => {
        requests.push(options);
        handler(options);
      },
    },
  };
  if (options.loginCode) {
    global.wx.login = (loginOptions) => loginOptions.success({ code: options.loginCode });
  }
  return {
    requests,
    toasts,
    removalCount: () => removals,
    hasStoredSession: () => Boolean(storedSession),
    getStoredSession: () => storedSession,
    setStoredSession: (session) => { storedSession = session; },
  };
}

function loadProfilePage() {
  let definition;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  delete require.cache[profilePagePath];
  require(profilePagePath);
  return definition;
}

function loadCourseDetailPage() {
  let definition;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  delete require.cache[courseDetailPagePath];
  require(courseDetailPagePath);
  return definition;
}

function loadTeachingPage() {
  let definition;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  delete require.cache[teachingPagePath];
  require(teachingPagePath);
  return definition;
}

function createPage(definition) {
  const page = {
    data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); },
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key];
  });
  return page;
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function teacherSummaryItems(request, options = {}) {
  const encodedIds = request.path.split('?ids=')[1] || '';
  const ids = encodedIds ? decodeURIComponent(encodedIds).split(',') : [];
  return ids.map((teacherId) => ({
    teacherId,
    likeCount: options.likeCount || 0,
    likedByMe: Boolean(options.likedByMe),
  }));
}

afterEach(() => {
  global.wx = originalWx;
  global.getApp = originalGetApp;
  global.Page = originalPage;
  delete require.cache[apiModulePath];
  delete require.cache[profilePagePath];
  delete require.cache[courseDetailPagePath];
  delete require.cache[teachingPagePath];
});

describe('小程序会话与资料请求边界', () => {
  it('测试身份只发送姓名和 12 位学号，且不携带旧 Bearer', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 201, data: { token: 'test-identity-token', mode: 'test-identity', expiresInSeconds: 60 } });
    });
    const api = loadApi();

    await expect(api.loginWithTestIdentity(
      { name: '测试姓名', studentNumber: '123456789012' },
      { deferPersist: true },
    )).resolves.toMatchObject({ token: 'test-identity-token', mode: 'test-identity' });

    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]).toMatchObject({
      path: '/api/v1/auth/test-identity',
      method: 'POST',
      data: { name: '测试姓名', studentNumber: '123456789012' },
    });
    expect(runtime.requests[0].header.Authorization).toBeUndefined();
    await expect(api.loginWithTestIdentity({ name: '测试姓名', studentNumber: '12345678901' })).rejects.toMatchObject({ code: 'INVALID_TEST_IDENTITY' });
    await expect(api.loginWithTestIdentity({ name: '测试姓名', studentNumber: '12345678901a' })).rejects.toMatchObject({ code: 'INVALID_TEST_IDENTITY' });
  });

  it('昵称更新不会提交临时头像路径', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 200, data: { nickname: '新昵称', avatarUrl: null } });
    });
    const api = loadApi();

    await expect(api.updateProfile({ nickname: '新昵称', avatarUrl: 'wxfile://temporary-avatar' })).resolves.toMatchObject({ nickname: '新昵称' });

    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0].data).toEqual({ nickname: '新昵称' });
  });

  it.each(['SESSION_INVALID', 'AUTH_REQUIRED'])('显式 %s 响应清除本地会话', async (serverCode) => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 401, data: { error: { code: serverCode, message: '会话需要重新登录' } } });
    });
    const api = loadApi();

    await expect(api.getProfile()).rejects.toMatchObject({
      code: serverCode,
      sessionInvalid: true,
      sessionCleared: true,
      sessionSuperseded: false,
    });

    expect(runtime.removalCount()).toBe(1);
    expect(runtime.hasStoredSession()).toBe(false);
    expect(api.hasSession()).toBe(false);
  });

  it.each(['SESSION_INVALID', 'AUTH_REQUIRED'])('旧会话请求迟到返回 %s 时保留已建立的新会话', async (serverCode) => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); }, {
      initialSession: { token: 'old-session', mode: 'wechat', expiresAt: Date.now() + 60_000 },
    });
    const api = loadApi();

    const oldRequest = api.getProfile();
    expect(pending).toHaveLength(1);
    expect(pending[0].header.Authorization).toBe('Bearer old-session');

    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[0].success({ statusCode: 401, data: { error: { code: serverCode, message: '旧会话已失效' } } });

    await expect(oldRequest).rejects.toMatchObject({
      code: serverCode,
      sessionInvalid: true,
      sessionCleared: false,
      sessionSuperseded: true,
    });
    expect(runtime.removalCount()).toBe(0);
    expect(runtime.getStoredSession()).toMatchObject({ token: 'new-session', mode: 'wechat' });
    expect(api.hasSession()).toBe(true);
  });

  it('旧会话请求迟到成功时作废响应并保留新会话', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); }, {
      initialSession: { token: 'old-session', mode: 'wechat', expiresAt: Date.now() + 60_000 },
    });
    const api = loadApi();

    const oldRequest = api.getProfile();
    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[0].success({ statusCode: 200, data: { nickname: '旧会话资料' } });

    await expect(oldRequest).rejects.toMatchObject({
      code: 'SESSION_SUPERSEDED',
      sessionInvalid: true,
      sessionCleared: false,
      sessionSuperseded: true,
    });
    expect(runtime.getStoredSession()).toMatchObject({ token: 'new-session', mode: 'wechat' });
    expect(api.hasSession()).toBe(true);
  });

  it('无会话请求迟到返回 AUTH_REQUIRED 时保留期间建立的会话', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); }, { initialSession: null });
    const api = loadApi();

    const anonymousRequest = api.getProfile();
    expect(pending).toHaveLength(1);
    expect(pending[0].header.Authorization).toBeUndefined();

    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[0].success({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: '请先登录' } } });

    await expect(anonymousRequest).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      sessionInvalid: true,
      sessionCleared: false,
      sessionSuperseded: true,
    });
    expect(runtime.removalCount()).toBe(0);
    expect(runtime.getStoredSession()).toMatchObject({ token: 'new-session', mode: 'wechat' });
    expect(api.hasSession()).toBe(true);
  });

  it('不携带 Bearer 的登录请求不清理已有会话', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); }, { loginCode: 'fresh-login-code' });
    const api = loadApi();

    const loginRequest = api.loginWithWechat({ deferPersist: true });
    await flushPromises();
    expect(pending).toHaveLength(1);
    expect(pending[0].header.Authorization).toBeUndefined();

    pending[0].success({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: '登录请求未通过' } } });

    await expect(loginRequest).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      sessionInvalid: true,
      sessionCleared: false,
      sessionSuperseded: true,
    });
    expect(runtime.removalCount()).toBe(0);
    expect(runtime.getStoredSession()).toMatchObject({ token: 'local-test-session', mode: 'wechat' });
    expect(api.hasSession()).toBe(true);
  });

  it('未明确失效的服务与网络错误保留本地会话', async () => {
    const serviceRuntime = installCloudRuntime((options) => {
      options.success({ statusCode: 503, data: { error: { code: 'WECHAT_AUTH_UNAVAILABLE', message: '服务暂不可用' } } });
    });
    const serviceApi = loadApi();

    await expect(serviceApi.getProfile()).rejects.toMatchObject({ code: 'WECHAT_AUTH_UNAVAILABLE' });
    expect(serviceRuntime.removalCount()).toBe(0);
    expect(serviceRuntime.hasStoredSession()).toBe(true);

    const networkRuntime = installCloudRuntime((options) => {
      options.fail();
    });
    const networkApi = loadApi();

    await expect(networkApi.getProfile()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(networkRuntime.removalCount()).toBe(0);
    expect(networkRuntime.hasStoredSession()).toBe(true);
  });
});

describe('个人中心会话状态', () => {
  it('云端测试模式使用姓名和 12 位学号进入测试身份并读取资料', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); }, {
      initialSession: null,
      authMode: 'test-identity',
    });
    const api = loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    expect(page.data).toMatchObject({ isCloudMode: true, isTestIdentityMode: true, isLoggedIn: false });
    page.setData({ studentName: '测试姓名', studentId: '123456789012' });
    page.loginWithTestIdentity();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      path: '/api/v1/auth/test-identity',
      data: { name: '测试姓名', studentNumber: '123456789012' },
    });
    pending[0].success({ statusCode: 201, data: { token: 'test-identity-token', mode: 'test-identity', expiresInSeconds: 60 } });
    await flushPromises();
    await flushPromises();

    expect(pending).toHaveLength(2);
    expect(pending[1].header.Authorization).toBe('Bearer test-identity-token');
    pending[1].success({
      statusCode: 200,
      data: { nickname: '新同学', bindingStatus: 'bound', privateBinding: { name: '测试姓名', studentNumber: '123456789012' } },
    });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({
      isLoggedIn: true,
      isTestIdentityMode: true,
      loginStatus: '测试身份',
      studentName: '测试姓名',
      studentId: '123456789012',
    });
    expect(runtime.toasts.some((toast) => toast.title === '已进入测试身份')).toBe(true);
    expect(api.hasSession()).toBe(true);
  });

  it('网络错误时保留登录态并提示重试', async () => {
    const runtime = installCloudRuntime((options) => {
      options.fail();
    });
    loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    await flushPromises();

    expect(page.data.isLoggedIn).toBe(true);
    expect(page.data.loginStatus).toBe('微信已登录');
    expect(page.data.serviceStatus).toBe('暂时无法读取个人资料，请稍后重试');
    expect(runtime.removalCount()).toBe(0);
    expect(runtime.hasStoredSession()).toBe(true);
  });

  it('明确会话失效且成功清除本地会话后回到登录入口', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    });
    loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    await flushPromises();

    expect(page.data.isLoggedIn).toBe(false);
    expect(page.data.loginStatus).toBe('登录已失效');
    expect(page.data.serviceStatus).toBe('登录已失效，请重新登录');
    expect(runtime.removalCount()).toBe(1);
    expect(runtime.hasStoredSession()).toBe(false);
  });

  it('本地会话清理失败时仍返回登录入口', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    }, {
      removeStorageError: new Error('storage removal unavailable'),
    });
    const api = loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    await flushPromises();
    await flushPromises();

    expect(page.data.isCloudMode).toBe(true);
    expect(page.data.isLoggedIn).toBe(false);
    expect(page.data.loginStatus).toBe('登录已失效');
    expect(page.data.serviceStatus).toBe('登录已失效，请重新登录');
    expect(runtime.removalCount()).toBe(1);
    expect(runtime.hasStoredSession()).toBe(true);
    expect(api.hasSession()).toBe(false);
    expect(runtime.toasts.some((toast) => toast.title === '微信登录成功' || toast.icon === 'success')).toBe(false);
  });

  it('会话失效后不会接受滞后的资料读取结果', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    });
    loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    page.setData({ bindingStatus: 'unbound', studentName: '测试姓名', studentId: '12345678' });
    page.bindProfile();
    expect(pending).toHaveLength(2);

    pending[1].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();

    pending[0].success({
      statusCode: 200,
      data: {
        nickname: '滞后昵称',
        bindingStatus: 'bound',
        privateBinding: { name: '滞后姓名', studentNumber: '87654321' },
      },
    });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({
      isLoggedIn: false,
      loginStatus: '登录已失效',
      nickname: '',
      bindingStatus: 'real-login-pending',
      studentName: '',
      studentId: '',
    });
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });

  it('会话失效后不会接受滞后的绑定和昵称保存结果', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    });
    loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    page.setData({
      bindingStatus: 'unbound',
      studentName: '测试姓名',
      studentId: '12345678',
      nickname: '当前昵称',
    });
    page.bindProfile();
    page.saveProfile();
    page.loadProfile();
    expect(pending).toHaveLength(4);

    pending[3].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();

    pending[0].success({ statusCode: 200, data: { nickname: '滞后资料', bindingStatus: 'bound', privateBinding: { name: '滞后姓名', studentNumber: '87654321' } } });
    pending[1].success({ statusCode: 201, data: { nickname: '绑定结果', bindingStatus: 'bound', privateBinding: { name: '绑定姓名', studentNumber: '87654321' } } });
    pending[2].success({ statusCode: 200, data: { nickname: '保存结果', avatarUrl: null } });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({
      isLoggedIn: false,
      loginStatus: '登录已失效',
      nickname: '',
      bindingStatus: 'real-login-pending',
      studentName: '',
      studentId: '',
      isBindingProfile: false,
      isSavingProfile: false,
    });
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });

  it('503 时保留登录态并提示重试', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 503, data: { error: { code: 'WECHAT_AUTH_UNAVAILABLE', message: '服务暂不可用' } } });
    });
    loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    await flushPromises();

    expect(page.data).toMatchObject({
      isLoggedIn: true,
      loginStatus: '微信已登录',
      serviceStatus: '暂时无法读取个人资料，请稍后重试',
    });
    expect(runtime.removalCount()).toBe(0);
    expect(runtime.hasStoredSession()).toBe(true);
  });

  it('旧资料请求被新会话取代时刷新新资料而不退出登录', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    const api = loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    expect(pending).toHaveLength(1);
    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[0].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '旧会话已失效' } } });
    await flushPromises();
    await flushPromises();

    expect(pending).toHaveLength(2);
    expect(pending[1].header.Authorization).toBe('Bearer new-session');
    pending[1].success({
      statusCode: 200,
      data: { nickname: '新会话资料', bindingStatus: 'unbound', privateBinding: { name: null, studentNumber: null } },
    });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({ isLoggedIn: true, loginStatus: '微信已登录', nickname: '新会话资料' });
    expect(runtime.removalCount()).toBe(0);
    expect(runtime.hasStoredSession()).toBe(true);
  });

  it('无鉴权登录请求被现有会话取代时刷新资料且不提示重新登录', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); }, { loginCode: 'refresh-login-code' });
    const page = createPage(loadProfilePage());

    page.setData({ isLoggedIn: true, loginStatus: '微信已登录' });
    page.loginWithWechat();
    await flushPromises();
    expect(pending).toHaveLength(1);
    pending[0].success({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: '登录请求已作废' } } });
    await flushPromises();
    await flushPromises();

    expect(pending).toHaveLength(2);
    expect(pending[1].header.Authorization).toBe('Bearer local-test-session');
    expect(runtime.toasts.some((toast) => toast.title === '登录已失效，请重新登录')).toBe(false);
    pending[1].success({ statusCode: 200, data: { nickname: '现有会话资料', bindingStatus: 'unbound' } });
    await flushPromises();
    expect(page.data).toMatchObject({ isLoggedIn: true, nickname: '现有会话资料', isCreatingSession: false });
  });

  it('会话存储失败时保留可重试入口且不显示登录成功', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 201, data: { token: 'new-test-session', mode: 'wechat', expiresInSeconds: 60 } });
    }, {
      initialSession: null,
      loginCode: 'storage-failure-code',
      setStorageError: new Error('storage unavailable'),
    });
    loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    page.loginWithWechat();
    await flushPromises();
    await flushPromises();

    expect(page.data.isCloudMode).toBe(true);
    expect(page.data.isLoggedIn).toBe(false);
    expect(page.data.isCreatingSession).toBe(false);
    expect(page.data.loginStatus).toBe('登录未完成');
    expect(runtime.hasStoredSession()).toBe(false);
    expect(runtime.toasts.some((toast) => toast.title === '微信登录成功' || toast.icon === 'success')).toBe(false);
  });

  it('会话失效后微信登录迟到成功不重新持久化会话', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    }, { loginCode: 'late-wechat-code' });
    const api = loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    page.loginWithWechat();
    await flushPromises();
    expect(pending).toHaveLength(2);

    pending[0].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();
    pending[1].success({ statusCode: 201, data: { token: 'late-wechat-session', mode: 'wechat', expiresInSeconds: 60 } });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({ isLoggedIn: false, isCreatingSession: false, loginStatus: '登录已失效' });
    expect(runtime.hasStoredSession()).toBe(false);
    expect(api.hasSession()).toBe(false);
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });

  it('会话失效后开发测试会话迟到成功不重新持久化会话', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    });
    const api = loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    page.startDevelopmentSession();
    expect(pending).toHaveLength(2);

    pending[0].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();
    pending[1].success({ statusCode: 201, data: { token: 'late-development-session', mode: 'development-test-only', expiresInSeconds: 60 } });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({ isLoggedIn: false, isCreatingSession: false, loginStatus: '登录已失效' });
    expect(runtime.hasStoredSession()).toBe(false);
    expect(api.hasSession()).toBe(false);
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });

  it('资料刷新作废操作后解除 busy 状态且忽略迟到成功', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    });
    loadApi();
    const page = createPage(loadProfilePage());

    page.onShow();
    page.setData({
      bindingStatus: 'unbound',
      studentName: '测试姓名',
      studentId: '12345678',
      nickname: '当前昵称',
    });
    page.bindProfile();
    page.saveProfile();
    page.startDevelopmentSession();
    page.loadProfile();
    expect(pending).toHaveLength(5);

    pending[4].success({ statusCode: 503, data: { error: { code: 'WECHAT_AUTH_UNAVAILABLE', message: '服务暂不可用' } } });
    await flushPromises();
    await flushPromises();
    pending[1].success({ statusCode: 201, data: { nickname: '绑定结果', bindingStatus: 'bound', privateBinding: { name: '绑定姓名', studentNumber: '87654321' } } });
    pending[2].success({ statusCode: 200, data: { nickname: '保存结果', avatarUrl: null } });
    pending[3].success({ statusCode: 201, data: { token: 'late-development-session', mode: 'development-test-only', expiresInSeconds: 60 } });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({
      isLoggedIn: true,
      isBindingProfile: false,
      isSavingProfile: false,
      isCreatingSession: false,
      serviceStatus: '暂时无法读取个人资料，请稍后重试',
    });
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });
});

describe('会话存储失败', () => {
  it('延后持久化的微信会话响应不会自行写入本地会话', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 201, data: { token: 'deferred-test-session', mode: 'wechat', expiresInSeconds: 60 } });
    }, {
      initialSession: null,
      loginCode: 'deferred-persist-code',
    });
    const api = loadApi();

    await expect(api.loginWithWechat({ deferPersist: true })).resolves.toMatchObject({ token: 'deferred-test-session', mode: 'wechat' });

    expect(runtime.hasStoredSession()).toBe(false);
    expect(api.hasSession()).toBe(false);
  });

  it('微信登录拒绝并清除已有本地会话', async () => {
    const runtime = installCloudRuntime((options) => {
      options.success({ statusCode: 201, data: { token: 'new-test-session', mode: 'wechat', expiresInSeconds: 60 } });
    }, {
      initialSession: { token: 'old-test-session', mode: 'wechat', expiresAt: Date.now() + 60_000 },
      loginCode: 'storage-failure-code',
      setStorageError: new Error('storage unavailable'),
    });
    const api = loadApi();

    await expect(api.loginWithWechat()).rejects.toMatchObject({ code: 'SESSION_STORAGE_UNAVAILABLE' });

    expect(runtime.removalCount()).toBe(1);
    expect(runtime.hasStoredSession()).toBe(false);
    expect(api.hasSession()).toBe(false);
  });
});

describe('教师目录页会话状态', () => {
  it('旧摘要请求被新会话取代时使用新会话重新加载', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    const api = loadApi();
    const page = createPage(loadTeachingPage());

    page.onLoad();
    page.onShow();
    expect(pending).toHaveLength(1);
    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[0].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '旧会话已失效' } } });
    await flushPromises();
    await flushPromises();

    expect(pending).toHaveLength(2);
    expect(pending[1].header.Authorization).toBe('Bearer new-session');
    pending[1].success({ statusCode: 200, data: { items: teacherSummaryItems(pending[1], { likeCount: 6, likedByMe: true }) } });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({ isLoggedIn: true, feedbackConnected: true });
    expect(page.data.teachers[0]).toMatchObject({ hasLiked: true, isLiking: false, likeCount: 6 });
    expect(runtime.removalCount()).toBe(0);
  });

  it('旧会话教师点赞作废后刷新且不提示重新登录', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    const api = loadApi();
    const page = createPage(loadTeachingPage());

    page.onLoad();
    page.onShow();
    pending[0].success({ statusCode: 200, data: { items: teacherSummaryItems(pending[0], { likeCount: 2 }) } });
    await flushPromises();
    const teacher = page.data.teachers[0];
    page.likeTeacher({ currentTarget: { dataset: { id: teacher.id } } });
    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[1].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '旧会话已失效' } } });
    await flushPromises();
    await flushPromises();

    expect(pending).toHaveLength(3);
    expect(pending[2].header.Authorization).toBe('Bearer new-session');
    expect(runtime.toasts.some((toast) => toast.title === '登录已失效，请重新登录')).toBe(false);
  });

  it.each(['SESSION_INVALID', 'AUTH_REQUIRED'])('%s 使并发点赞失效且迟到成功不回写', async (serverCode) => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    const api = loadApi();
    const page = createPage(loadTeachingPage());

    page.onLoad();
    page.onShow();
    expect(pending).toHaveLength(1);
    pending[0].success({ statusCode: 200, data: { items: teacherSummaryItems(pending[0], { likeCount: 7 }) } });
    await flushPromises();

    const teacher = page.data.teachers[0];
    page.likeTeacher({ currentTarget: { dataset: { id: teacher.id } } });
    page.loadTeacherFeedbackSummary();
    expect(pending).toHaveLength(3);

    pending[2].success({ statusCode: 401, data: { error: { code: serverCode, message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();
    pending[1].success({ statusCode: 201, data: { liked: true, likeCount: 8 } });
    await flushPromises();
    await flushPromises();

    const finalTeacher = page.data.teachers.find((item) => item.id === teacher.id);
    expect(page.data).toMatchObject({ isLoggedIn: false, feedbackConnected: false });
    expect(finalTeacher).toMatchObject({ hasLiked: false, isLiking: false, likeCount: 7 });
    expect(runtime.hasStoredSession()).toBe(false);
    expect(api.hasSession()).toBe(false);
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });

  it.each([
    ['网络错误', (request) => request.fail()],
    ['503', (request) => request.success({ statusCode: 503, data: { error: { code: 'WECHAT_AUTH_UNAVAILABLE', message: '服务暂不可用' } } })],
  ])('%s 保留登录态并解除点赞 busy', async (_label, rejectLike) => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    loadApi();
    const page = createPage(loadTeachingPage());

    page.onLoad();
    page.onShow();
    pending[0].success({ statusCode: 200, data: { items: teacherSummaryItems(pending[0], { likeCount: 3 }) } });
    await flushPromises();

    const teacher = page.data.teachers[0];
    page.likeTeacher({ currentTarget: { dataset: { id: teacher.id } } });
    rejectLike(pending[1]);
    await flushPromises();
    await flushPromises();

    const finalTeacher = page.data.teachers.find((item) => item.id === teacher.id);
    expect(page.data).toMatchObject({ isLoggedIn: true, feedbackConnected: true });
    expect(finalTeacher).toMatchObject({ hasLiked: false, isLiking: false, likeCount: 3 });
    expect(runtime.hasStoredSession()).toBe(true);
    expect(runtime.removalCount()).toBe(0);
    expect(runtime.toasts.some((toast) => toast.icon === 'none')).toBe(true);
  });

  it('有效会话下教师点赞正常更新状态并显示成功提示', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    loadApi();
    const page = createPage(loadTeachingPage());

    page.onLoad();
    page.onShow();
    pending[0].success({ statusCode: 200, data: { items: teacherSummaryItems(pending[0], { likeCount: 4 }) } });
    await flushPromises();

    const teacher = page.data.teachers[0];
    page.likeTeacher({ currentTarget: { dataset: { id: teacher.id } } });
    pending[1].success({ statusCode: 201, data: { liked: true, likeCount: 5 } });
    await flushPromises();
    await flushPromises();

    expect(page.data.teachers.find((item) => item.id === teacher.id)).toMatchObject({ hasLiked: true, isLiking: false, likeCount: 5 });
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(true);
  });

  it('页面重新显示后旧会话摘要不会覆盖新会话结果', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    loadApi();
    const page = createPage(loadTeachingPage());

    page.onLoad();
    page.onShow();
    runtime.setStoredSession({ token: 'new-session', mode: 'wechat', expiresAt: Date.now() + 60_000 });
    page.onShow();
    expect(pending).toHaveLength(2);

    pending[1].success({ statusCode: 200, data: { items: teacherSummaryItems(pending[1], { likeCount: 2, likedByMe: true }) } });
    await flushPromises();
    pending[0].success({ statusCode: 200, data: { items: teacherSummaryItems(pending[0], { likeCount: 9 }) } });
    await flushPromises();
    await flushPromises();

    expect(page.data.isLoggedIn).toBe(true);
    expect(page.data.teachers[0]).toMatchObject({ hasLiked: true, isLiking: false, likeCount: 2 });
  });
});

describe('课程详情会话失效状态', () => {
  it('旧反馈请求被新会话取代时使用新会话重新加载', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    const api = loadApi();
    const page = createPage(loadCourseDetailPage());
    page.setData({
      course: { code: '10000001', name: '测试课程' },
      directoryTeachers: [],
      feedbackConnected: true,
      teacherFeedbackConnected: true,
      isLoggedIn: true,
      isLiking: true,
      isSubmittingComment: true,
    });

    page.loadFeedback('10000001:测试课程');
    expect(pending).toHaveLength(1);
    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[0].success({ statusCode: 200, data: { likedByMe: false, likeCount: 99, comments: [{ content: '旧会话结果' }] } });
    await flushPromises();
    await flushPromises();

    expect(pending).toHaveLength(2);
    expect(pending[1].header.Authorization).toBe('Bearer new-session');
    expect(page.data).toMatchObject({ isLoggedIn: true, isLiking: false, isSubmittingComment: false });
    pending[1].success({ statusCode: 200, data: { likedByMe: true, likeCount: 4, comments: [] } });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({ isLoggedIn: true, feedbackConnected: true, hasLiked: true, likeCount: 4 });
    expect(runtime.removalCount()).toBe(0);
  });

  it('旧会话课程点赞成功作废后刷新且不提示重新登录', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => { pending.push(options); });
    const api = loadApi();
    const page = createPage(loadCourseDetailPage());
    page.setData({
      course: { code: '10000001', name: '测试课程' },
      directoryTeachers: [],
      feedbackConnected: true,
      teacherFeedbackConnected: true,
      isLoggedIn: true,
      hasLiked: false,
    });

    page.likeCourse();
    api.persistSession({ token: 'new-session', mode: 'wechat', expiresInSeconds: 60 });
    pending[0].success({ statusCode: 201, data: { liked: true, likeCount: 1 } });
    await flushPromises();
    await flushPromises();

    expect(pending).toHaveLength(2);
    expect(pending[1].header.Authorization).toBe('Bearer new-session');
    expect(runtime.toasts.some((toast) => toast.title === '登录已失效，请重新登录')).toBe(false);
  });

  it('明确会话失效后不依赖本地清理结果退出所有可写状态', () => {
    const page = createPage(loadCourseDetailPage());
    page.setData({
      feedbackConnected: true,
      teacherFeedbackConnected: true,
      isLoggedIn: true,
      hasLiked: true,
      isLiking: true,
      isSubmittingComment: true,
      directoryTeachers: [{ directoryId: 'teacher-a', hasLiked: true, isLiking: true }],
    });

    expect(page.handleSessionInvalid({ sessionInvalid: true, sessionCleared: false })).toBe(true);

    expect(page.data).toMatchObject({
      feedbackConnected: false,
      teacherFeedbackConnected: false,
      isLoggedIn: false,
      hasLiked: false,
      isLiking: false,
      isSubmittingComment: false,
    });
    expect(page.data.directoryTeachers).toEqual([{ directoryId: 'teacher-a', hasLiked: false, isLiking: false }]);
  });

  it('网络错误不会退出课程详情的可写状态', () => {
    const page = createPage(loadCourseDetailPage());
    page.setData({ isLoggedIn: true, hasLiked: true, feedbackConnected: true });

    expect(page.handleSessionInvalid({ code: 'NETWORK_ERROR' })).toBe(false);
    expect(page.data).toMatchObject({ isLoggedIn: true, hasLiked: true, feedbackConnected: true });
  });

  it('本地清理失败后的显式会话失效阻止滞后反馈和教师摘要回写', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    }, {
      removeStorageError: new Error('storage removal unavailable'),
    });
    const api = loadApi();
    const page = createPage(loadCourseDetailPage());
    const teacherId = `directory:${'a'.repeat(64)}`;
    const teachers = [{ directoryId: teacherId, name: '测试教师', hasLiked: false, isLiking: false }];
    page.setData({
      course: { code: '10000001', name: '测试课程' },
      directoryTeachers: teachers,
      feedbackConnected: true,
      teacherFeedbackConnected: true,
      isLoggedIn: true,
      hasLiked: false,
      commentText: '待发布评论',
      isSubmittingComment: true,
    });

    page.loadFeedback('10000001:测试课程');
    page.loadTeacherFeedbackSummary(teachers);
    page.loadFeedback('10000001:测试课程');
    expect(pending).toHaveLength(3);

    pending[2].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();

    pending[0].success({
      statusCode: 200,
      data: { likeCount: 7, likedByMe: true, comments: [{ content: '滞后课程反馈', createdAt: '2026-07-27T00:00:00Z' }] },
    });
    pending[1].success({
      statusCode: 200,
      data: { items: [{ teacherId, likeCount: 5, likedByMe: true }] },
    });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({
      feedbackConnected: false,
      teacherFeedbackConnected: false,
      isLoggedIn: false,
      hasLiked: false,
      isLiking: false,
      isSubmittingComment: false,
      commentText: '',
    });
    expect(page.data.directoryTeachers[0]).toMatchObject({ directoryId: teacherId, hasLiked: false, isLiking: false });
    expect(runtime.hasStoredSession()).toBe(true);
    expect(api.hasSession()).toBe(false);
    expect(runtime.toasts.some((toast) => toast.title === '微信登录成功' || toast.icon === 'success')).toBe(false);
  });

  it('课程点赞失效后忽略滞后的成功响应', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    });
    loadApi();
    const page = createPage(loadCourseDetailPage());
    page.setData({
      course: { code: '10000001', name: '测试课程' },
      feedbackConnected: true,
      isLoggedIn: true,
      hasLiked: false,
    });

    page.likeCourse();
    page.loadFeedback('10000001:测试课程');
    expect(pending).toHaveLength(2);

    pending[1].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();
    pending[0].success({ statusCode: 201, data: { liked: true, likeCount: 1 } });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({ isLoggedIn: false, hasLiked: false, isLiking: false });
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });

  it('教师点赞失效后忽略滞后的成功响应', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    });
    loadApi();
    const page = createPage(loadCourseDetailPage());
    const teacherId = `directory:${'b'.repeat(64)}`;
    page.setData({
      course: { code: '10000001', name: '测试课程' },
      directoryTeachers: [{ directoryId: teacherId, hasLiked: false, isLiking: false }],
      feedbackConnected: true,
      teacherFeedbackConnected: true,
      isLoggedIn: true,
    });

    page.likeTeacher({ currentTarget: { dataset: { id: teacherId } } });
    page.loadFeedback('10000001:测试课程');
    expect(pending).toHaveLength(2);

    pending[1].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();
    pending[0].success({ statusCode: 201, data: { liked: true, likeCount: 1 } });
    await flushPromises();
    await flushPromises();

    expect(page.data.isLoggedIn).toBe(false);
    expect(page.data.directoryTeachers[0]).toMatchObject({ directoryId: teacherId, hasLiked: false, isLiking: false });
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });

  it('评论提交失效后不会追加滞后评论', async () => {
    const pending = [];
    const runtime = installCloudRuntime((options) => {
      pending.push(options);
    });
    loadApi();
    const page = createPage(loadCourseDetailPage());
    page.setData({
      course: { code: '10000001', name: '测试课程' },
      feedbackConnected: true,
      isLoggedIn: true,
      hasLiked: true,
      commentText: '待提交评论',
      comments: [{ content: '已有评论', createdAt: '2026-07-27T00:00:00Z' }],
    });

    page.submitComment();
    page.loadFeedback('10000001:测试课程');
    expect(pending).toHaveLength(2);

    pending[1].success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } });
    await flushPromises();
    await flushPromises();
    pending[0].success({
      statusCode: 201,
      data: { comment: { content: '滞后评论', createdAt: '2026-07-27T00:00:01Z' } },
    });
    await flushPromises();
    await flushPromises();

    expect(page.data).toMatchObject({
      isLoggedIn: false,
      isSubmittingComment: false,
      commentText: '',
      comments: [{ content: '已有评论', createdAt: '2026-07-27T00:00:00Z' }],
    });
    expect(runtime.toasts.some((toast) => toast.icon === 'success')).toBe(false);
  });
});
