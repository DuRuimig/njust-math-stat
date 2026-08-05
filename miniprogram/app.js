App({
  globalData: {
    // 体验版显式走云托管；本地开发需手动改回 "local"。
    apiMode: "cloud",
    authMode: "wechat",
    apiBaseUrl: "http://127.0.0.1:2001",
    apiContractPrefix: "/api/v1",
    cloudEnvironmentId: "prod-d5gfes93j0a83438c",
    cloudContainerService: "express-4id4",
    cloudAvailable: false
  },

  onLaunch: function () {
    var cloud = typeof wx !== "undefined" && wx.cloud
    if (!cloud || typeof cloud.init !== "function") return

    try {
      cloud.init({
        env: this.globalData.cloudEnvironmentId,
        traceUser: true
      })
      this.globalData.cloudAvailable = true
    } catch (_error) {
      // 本地 Node 检查或不支持云能力的开发者工具中不阻断小程序启动。
      this.globalData.cloudAvailable = false
    }
  }
})
