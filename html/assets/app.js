/* Model Bridge — framework-free, local HTML design prototype. No backend requests. */
"use strict";
(() => {
  let page = location.hash.slice(1) || document.body.dataset.page || "overview";
  let isUser = page.startsWith("user-");
  const icons = window.BRIDGE_ICONS;
  // Utility icons follow the Heroicons outline vocabulary already used by the app.
  Object.assign(icons, {
    search: ["m21 21-4.3-4.3", "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
    plus: ["M12 5v14M5 12h14"],
    close: ["m6 6 12 12M6 18 18 6"],
    chevron: ["m9 5 7 7-7 7"],
    down: ["m7 10 5 5 5-5"],
    copy: ["M9 9h11v11H9z", "M15 9V4H4v11h5"],
    arrow: ["M5 12h14m-5-5 5 5-5 5"],
    trend: ["m4 16 6-6 4 4 6-9", "M14 5h6v6"],
    check: ["m5 12 4 4L19 6"],
    refresh: [
      "M20 7v5h-5",
      "M4 17v-5h5",
      "M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1",
    ],
    download: ["M12 3v12m-5-5 5 5 5-5", "M4 16v5h16v-5"],
    bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
    sun: [
      "M12 3V1m0 22v-2M3 12H1m22 0h-2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4m0-15.6-1.4 1.4M5.6 18.4l-1.4 1.4",
      "M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
    ],
    menu: ["M4 6h16M4 12h16M4 18h16"],
    dots: ["M5 12h.01M12 12h.01M19 12h.01"],
    external: ["M14 3h7v7m0-7L10 14", "M10 3H3v18h18v-7"],
    clock: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", "M12 7v5l3 2"],
    shield: ["m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3", "m8 12 3 3 5-6"],
    logout: ["M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"],
    info: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", "M12 11v6M12 7h.01"],
    mail: ["M3 5h18v14H3z", "m3 5 9 7 9-7"],
    filter: ["M4 6h16M7 12h10M10 18h4"],
    edit: ["m16 3 5 5-12 12H4v-5L16 3", "m13 6 5 5"],
    trash: ["M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"],
    code: ["m8 6-6 6 6 6M16 6l6 6-6 6"],
    wallet: ["M3 5h16v4H3v12h18V9H3V5z", "M16 13h5v4h-5z"],
    calendar: ["M4 5h16v16H4zM8 3v4M16 3v4M4 10h16"],
  });
  const I = (name, extra = "") =>
    `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${(icons[name] || icons.models).map((d) => `<path d="${d}"/>`).join("")}</svg>`;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const usd = (n, digits = 2) =>
    "$" +
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const num = (n) => Number(n).toLocaleString("en-US");
  const file = (route) => "index.html#" + route;
  const href = (route) =>
    file(
      isUser && ["overview", "keys", "models", "api-docs"].includes(route)
        ? "user-" + route
        : route,
    );
  const btn = (text, action, icon = "", primary = false, attrs = "") => {
    const extra = attrs.match(/class="([^"]*)"/)?.[1] || "";
    return `<button type="button" class="btn ${primary ? "btn-primary" : ""} ${extra}" data-action="${action}" ${attrs.replace(/class="[^"]*"/, "")}>${icon ? I(icon) : ""}${text}</button>`;
  };
  const link = (text, route, icon = "", primary = false) =>
    `<a class="btn ${primary ? "btn-primary" : ""}" href="${file(route)}">${icon ? I(icon) : ""}${text}</a>`;
  const badge = (text, tone = "green") =>
    `<span class="badge ${tone}"><span class="dot"></span>${esc(text)}</span>`;
  const iconButton = (name, action, label, attrs = "") => {
    const extra = attrs.match(/class="([^"]*)"/)?.[1] || "";
    return `<button class="btn btn-icon btn-ghost ${extra}" type="button" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs.replace(/class="[^"]*"/, "")}>${I(name)}</button>`;
  };
  const providers = {
    claude: { name: "Anthropic", short: "A", model: "Claude" },
    openai: { name: "OpenAI", short: "AI", model: "GPT" },
    gemini: { name: "Google Gemini", short: "G", model: "Gemini" },
    deepseek: { name: "DeepSeek", short: "DS", model: "DeepSeek" },
    xiaomi: { name: "小米 MiMo", short: "Mi", model: "MiMo" },
    zhipu: { name: "智谱 GLM", short: "智", model: "GLM" },
    qwen: { name: "通义 Qwen", short: "通", model: "Qwen" },
    kimi: { name: "Kimi", short: "K", model: "Kimi" },
  };
  const providerAvatar = (p) =>
    `<span class="provider-avatar ${p}" aria-hidden="true">${providers[p]?.short || "MB"}</span>`;
  const pages = {
    overview: ["总览", "OVERVIEW", "从每一次请求，了解你的模型网络。"],
    models: ["模型广场", "MODEL EXPLORER", "为下一次创作，找到合适的模型。"],
    accounts: [
      "上游账户",
      "UPSTREAM ACCOUNTS",
      "连接服务商，管理账户状态与调度额度。",
    ],
    "account-groups": [
      "分组管理",
      "ACCOUNT GROUPS",
      "按使用场景组织账户池，灵活分配模型资源。",
    ],
    keys: ["API 密钥", "API KEYS", "安全地连接应用，精确控制访问和用量。"],
    users: ["用户钱包", "USER WALLETS", "管理用户、钱包余额与订阅权限。"],
    payments: ["充值订单", "PAYMENT ORDERS", "每一笔充值，都清晰可追溯。"],
    "redeem-codes": [
      "兑换码",
      "REDEEM CODES",
      "创建额度兑换码，轻松分发使用权益。",
    ],
    "subscription-plans": [
      "订阅套餐",
      "SUBSCRIPTION PLANS",
      "为不同需求，提供合适的模型使用额度。",
    ],
    stats: ["用量统计", "USAGE ANALYTICS", "把模型消耗，变成清晰可见的趋势。"],
    docs: [
      "使用文档",
      "DOCUMENTATION",
      "只需几步，让你熟悉的工具连接 Model Bridge。",
    ],
    "api-docs": ["API 文档", "API REFERENCE", "统一的接口，熟悉的开发体验。"],
    settings: ["系统设置", "SETTINGS", "按你的方式，配置 Model Bridge。"],
    "user-overview": [
      "我的概览",
      "MY WORKSPACE",
      "欢迎回来，Alex。这是你的模型使用概况。",
    ],
    "user-models": [
      "模型广场",
      "MODEL EXPLORER",
      "为下一次创作，找到合适的模型。",
    ],
    "user-keys": [
      "我的密钥",
      "MY API KEYS",
      "为每个应用创建独立密钥，轻松管理访问。",
    ],
    "user-usage": [
      "用量流水",
      "MY USAGE",
      "每一次调用，每一笔扣费，都有迹可循。",
    ],
    "user-api-docs": [
      "API 文档",
      "API REFERENCE",
      "从第一个请求开始，连接你的应用。",
    ],
  };
  const adminNav = [
    [
      "工作空间",
      [
        ["overview", "总览", "overview"],
        ["stats", "用量统计", "stats"],
        ["models", "模型广场", "models"],
      ],
    ],
    [
      "资源管理",
      [
        ["accounts", "上游账户", "accounts"],
        ["account-groups", "分组管理", "account-groups"],
        ["keys", "API 密钥", "keys"],
      ],
    ],
    [
      "运营管理",
      [
        ["users", "用户钱包", "users"],
        ["subscription-plans", "订阅套餐", "subscription-plans"],
        ["payments", "充值订单", "payments"],
        ["redeem-codes", "兑换码", "redeem-codes"],
      ],
    ],
    [
      "支持与配置",
      [
        ["docs", "使用文档", "docs"],
        ["api-docs", "API 文档", "api-docs"],
        ["settings", "系统设置", "settings"],
      ],
    ],
  ];
  const userNav = [
    [
      "工作空间",
      [
        ["user-overview", "我的概览", "overview"],
        ["user-models", "模型广场", "models"],
        ["user-keys", "我的密钥", "keys"],
        ["user-usage", "用量流水", "stats"],
      ],
    ],
    ["开发者", [["user-api-docs", "API 文档", "docs"]]],
  ];
  const initial = {
    accounts: [
      {
        id: "acc-1",
        name: "Claude · 主账户",
        provider: "claude",
        auth: "OAuth",
        group: "生产环境",
        used: 42,
        status: "正常",
        priority: 80,
        latency: 342,
      },
      {
        id: "acc-2",
        name: "OpenAI · 团队账户",
        provider: "openai",
        auth: "OAuth",
        group: "生产环境",
        used: 68,
        status: "正常",
        priority: 90,
        latency: 286,
      },
      {
        id: "acc-3",
        name: "Gemini · 开发账户",
        provider: "gemini",
        auth: "OAuth",
        group: "开发测试",
        used: 27,
        status: "正常",
        priority: 60,
        latency: 418,
      },
      {
        id: "acc-4",
        name: "DeepSeek · API",
        provider: "deepseek",
        auth: "API Key",
        group: "默认账户池",
        used: 15,
        status: "正常",
        priority: 50,
        latency: 195,
      },
      {
        id: "acc-5",
        name: "Claude · 备用账户",
        provider: "claude",
        auth: "OAuth",
        group: "生产环境",
        used: 92,
        status: "冷却中",
        priority: 40,
        latency: 0,
      },
      {
        id: "acc-6",
        name: "OpenAI · 测试账户",
        provider: "openai",
        auth: "OAuth",
        group: "开发测试",
        used: 36,
        status: "已停用",
        priority: 30,
        latency: 0,
      },
    ],
    keys: [
      {
        id: "key-1",
        name: "Production API",
        owner: "Alex Chen",
        key: "mb-demo-production-8e2f94",
        group: "生产环境",
        provider: "全部服务商",
        used: 42.68,
        limit: 100,
        status: "启用",
        requests: 4862,
        rate: 120,
        concurrency: 10,
      },
      {
        id: "key-2",
        name: "Claude Code",
        owner: "Alex Chen",
        key: "mb-demo-claudecode-6c5a12",
        group: "生产环境",
        provider: "Anthropic",
        used: 18.32,
        limit: 50,
        status: "启用",
        requests: 1927,
        rate: 60,
        concurrency: 5,
      },
      {
        id: "key-3",
        name: "Development",
        owner: "Alex Chen",
        key: "mb-demo-development-7f3d20",
        group: "开发测试",
        provider: "全部服务商",
        used: 5.47,
        limit: 20,
        status: "启用",
        requests: 804,
        rate: 30,
        concurrency: 3,
      },
      {
        id: "key-4",
        name: "Design experiments",
        owner: "Lin Wang",
        key: "mb-demo-design-3a7b28",
        group: "开发测试",
        provider: "OpenAI",
        used: 12.92,
        limit: 30,
        status: "启用",
        requests: 1246,
        rate: 60,
        concurrency: 5,
      },
      {
        id: "key-5",
        name: "Archived project",
        owner: "Ming Li",
        key: "mb-demo-archive-9c1a00",
        group: "默认账户池",
        provider: "全部服务商",
        used: 9.15,
        limit: 10,
        status: "已停用",
        requests: 563,
        rate: 20,
        concurrency: 2,
      },
    ],
    groups: [
      {
        id: "group-1",
        name: "生产环境",
        description: "稳定优先，为正式应用提供持续可靠的模型服务。",
        rate: 1,
        count: 3,
        keys: 2,
        providers: ["claude", "openai"],
      },
      {
        id: "group-2",
        name: "开发测试",
        description: "更灵活的调度策略，让实验与迭代轻松进行。",
        rate: 0.8,
        count: 2,
        keys: 2,
        providers: ["openai", "gemini"],
      },
      {
        id: "group-3",
        name: "默认账户池",
        description: "未分组账户使用的默认资源池，适合通用任务。",
        rate: 1,
        count: 1,
        keys: 1,
        providers: ["deepseek"],
      },
    ],
    users: [
      {
        id: "usr-1",
        name: "Alex Chen",
        email: "alex@example.test",
        balance: 128.5,
        status: "正常",
        keys: 3,
        requests: 7593,
        cost: 66.47,
        plan: "Pro 开发者",
        concurrency: 10,
      },
      {
        id: "usr-2",
        name: "Lin Wang",
        email: "lin@example.test",
        balance: 86.2,
        status: "正常",
        keys: 1,
        requests: 1246,
        cost: 12.92,
        plan: "Starter 探索者",
        concurrency: 5,
      },
      {
        id: "usr-3",
        name: "Ming Li",
        email: "ming@example.test",
        balance: 0,
        status: "已停用",
        keys: 1,
        requests: 563,
        cost: 9.15,
        plan: "无订阅",
        concurrency: 2,
      },
      {
        id: "usr-4",
        name: "Yuki Zhang",
        email: "yuki@example.test",
        balance: 231.75,
        status: "正常",
        keys: 0,
        requests: 0,
        cost: 0,
        plan: "Team 协作者",
        concurrency: 20,
      },
      {
        id: "usr-5",
        name: "Kai Liu",
        email: "kai@example.test",
        balance: 54,
        status: "正常",
        keys: 0,
        requests: 0,
        cost: 0,
        plan: "Starter 探索者",
        concurrency: 5,
      },
    ],
    payments: [
      {
        id: "MB20260908001",
        user: "Alex Chen",
        amount: 100,
        status: "已入账",
        channel: "支付宝",
        time: "09-08 09:32",
        note: "账户充值",
      },
      {
        id: "MB20260908002",
        user: "Lin Wang",
        amount: 50,
        status: "待支付",
        channel: "支付宝",
        time: "09-08 10:16",
        note: "账户充值",
      },
      {
        id: "MB20260907003",
        user: "Yuki Zhang",
        amount: 200,
        status: "已入账",
        channel: "支付宝",
        time: "09-07 18:45",
        note: "账户充值",
      },
      {
        id: "MB20260907004",
        user: "Kai Liu",
        amount: 20,
        status: "已取消",
        channel: "支付宝",
        time: "09-07 15:20",
        note: "用户取消",
      },
      {
        id: "MB20260906005",
        user: "Lin Wang",
        amount: 100,
        status: "已入账",
        channel: "手动入账",
        time: "09-06 11:08",
        note: "团队充值",
      },
    ],
    codes: [
      {
        id: "code-1",
        code: "DEMO-WELCOME-8X2M",
        value: 20,
        status: "未兑换",
        batch: "BATCH-0908",
        expiry: "2026-10-08",
        note: "新用户体验",
        user: "—",
      },
      {
        id: "code-2",
        code: "DEMO-WELCOME-3F9K",
        value: 20,
        status: "未兑换",
        batch: "BATCH-0908",
        expiry: "2026-10-08",
        note: "新用户体验",
        user: "—",
      },
      {
        id: "code-3",
        code: "DEMO-TEAM-7G4P",
        value: 50,
        status: "已兑换",
        batch: "BATCH-0907",
        expiry: "2026-10-07",
        note: "团队补贴",
        user: "Alex Chen",
      },
      {
        id: "code-4",
        code: "DEMO-TEAM-6A2J",
        value: 50,
        status: "未兑换",
        batch: "BATCH-0907",
        expiry: "2026-10-07",
        note: "团队补贴",
        user: "—",
      },
    ],
    plans: [
      {
        id: "plan-1",
        name: "Starter 探索者",
        tag: "STARTER",
        description: "从一次灵感开始，适合个人体验与轻量使用。",
        price: 9,
        daily: 2,
        weekly: 10,
        monthly: 30,
        days: 30,
        group: "开发测试",
        status: "已上架",
      },
      {
        id: "plan-2",
        name: "Pro 开发者",
        tag: "PRO",
        description: "为你的日常开发工作，提供充足的模型资源。",
        price: 29,
        daily: 8,
        weekly: 40,
        monthly: 120,
        days: 30,
        group: "生产环境",
        status: "已上架",
      },
      {
        id: "plan-3",
        name: "Team 协作者",
        tag: "TEAM",
        description: "更多额度与更高并发，让团队的创意持续流动。",
        price: 79,
        daily: 25,
        weekly: 120,
        monthly: 360,
        days: 30,
        group: "生产环境",
        status: "已上架",
      },
    ],
    wallet: 128.5,
    subscription: "Pro 开发者",
    walletEntries: [
      {
        time: "09-08 09:32",
        type: "账户充值",
        amount: 100,
        balance: 128.5,
        note: "支付宝充值",
      },
      {
        time: "09-08 09:26",
        type: "模型调用",
        amount: -0.032,
        balance: 28.5,
        note: "claude-sonnet-4-6",
      },
      {
        time: "09-07 16:28",
        type: "兑换码",
        amount: 50,
        balance: 28.532,
        note: "团队补贴",
      },
    ],
    settings: {
      name: "Model Bridge",
      baseUrl: "http://localhost:3000",
      timezone: "Asia/Shanghai",
      email: "admin@example.test",
      registration: true,
      inviteOnly: false,
      quotaPause: true,
      threshold: 90,
      cooldown: 30,
      strategy: "优先级 + 最近最少使用",
      retry: 3,
      rateLimit: 300,
      writeLimit: 10,
      securityHeaders: true,
      urlGuard: true,
      theme: "light",
    },
  };
  let state;
  try {
    const raw = localStorage.getItem("model-bridge-html-v1");
    state = raw ? JSON.parse(raw) : null;
  } catch {}
  if (!state || !Array.isArray(state.accounts) || !state.settings)
    state = JSON.parse(JSON.stringify(initial));
  const save = () => {
    try {
      localStorage.setItem("model-bridge-html-v1", JSON.stringify(state));
    } catch {
      toast("浏览器未允许本地保存，当前操作将在本页生效。");
    }
  };
  document.documentElement.dataset.theme = state.settings.theme || "light";
  let period = "today",
    metricMode = "requests",
    charts = [],
    currentTable = null,
    modelCategory = "全部模型",
    modelProvider = "全部服务商",
    modelQuery = "",
    settingsTab = "general",
    docTab = "quickstart",
    authRole = "user";
  const activity = Array.from({ length: 32 }, (_, i) => {
    const ps = ["claude", "openai", "gemini", "claude", "deepseek", "openai"];
    const p = ps[i % 6];
    const models = {
      claude: "claude-sonnet-4-6",
      openai: "gpt-5.5",
      gemini: "gemini-2.5-pro",
      deepseek: "deepseek-chat",
    };
    return {
      id: "req-demo-" + (8432 - i),
      provider: p,
      model: models[p],
      key: ["Production API", "Claude Code", "Development"][i % 3],
      tokens: [8420, 6231, 12460, 3912, 5840, 2834][i % 6],
      cost: [0.0438, 0.0321, 0.0612, 0.0168, 0.0042, 0.0213][i % 6],
      latency: [342, 286, 418, 367, 195, 274][i % 6],
      status: i === 5 || i === 19 ? "失败" : "成功",
      time: `09-08 ${String(14 - Math.floor(i / 12)).padStart(2, "0")}:${String(32 - (i % 12) * 2).padStart(2, "0")}:${String(48 - (i % 13) * 3).padStart(2, "0")}`,
    };
  });
  const brand = (publicPage = false) =>
    `<a class="brand" href="${publicPage ? "landing.html" : "index.html"}" aria-label="Model Bridge ${publicPage ? "首页" : "总览"}"><img src="assets/favicon.svg" alt=""><div>${state.settings.name === "Model Bridge" ? "Model<span>Bridge</span>" : esc(state.settings.name)}</div></a>`;
  function navigation() {
    return (isUser ? userNav : adminNav)
      .map(
        ([label, items]) =>
          `<div class="nav-section"><div class="nav-label">${label}</div>${items.map(([route, title, icon]) => `<a class="nav-item ${route === page ? "active" : ""}" href="${file(route)}" ${route === page ? 'aria-current="page"' : ""}>${I(icon)}<span>${title}</span>${route === "accounts" ? `<span class="nav-count">${state.accounts.length}</span>` : ""}</a>`).join("")}</div>`,
      )
      .join("");
  }
  function shell(content) {
    const p = pages[page] || pages.overview;
    return `<button class="sidebar-overlay" data-action="close-sidebar" aria-label="关闭导航菜单"></button><aside class="sidebar" id="sidebar">${brand()}<div class="workspace-wrap"><button class="workspace-button" data-action="workspace" aria-haspopup="true" aria-expanded="false"><span class="workspace-symbol">${isUser ? "A" : "M"}</span><span class="workspace-copy"><strong>${isUser ? "我的工作空间" : "默认工作空间"}</strong><small>${isUser ? "PERSONAL WORKSPACE" : "ADMIN WORKSPACE"}</small></span>${I("down", "icon-sm")}</button></div><nav class="nav-scroll" aria-label="主导航">${navigation()}</nav><div class="sidebar-bottom"><div class="system-status"><span class="dot"></span>所有系统运行正常 <small>演示</small></div><div class="profile"><span class="avatar">${isUser ? "AC" : "AD"}</span><span class="profile-info"><strong>${isUser ? "Alex Chen" : "管理员"}</strong><small>${isUser ? "个人账户" : "admin@example.test"}</small></span>${iconButton("dots", "profile", "账户菜单", 'aria-haspopup="true" aria-expanded="false"')}</div></div></aside><div class="app-shell"><header class="topbar"><div class="flex">${iconButton("menu", "sidebar", "打开导航菜单", 'class="mobile-menu" aria-controls="sidebar" aria-expanded="false"')}<div class="breadcrumb">${I("overview", "icon-sm")}<span>${isUser ? "个人空间" : "工作空间"}</span><span>/</span><strong>${p[0]}</strong></div></div><div class="topbar-tools"><button class="global-search" data-action="search">${I("search", "icon-sm")}<span>搜索页面或功能</span><kbd>⌘ K</kbd></button><span class="tool-divider"></span><span class="pill"><span class="dot positive"></span>本地演示</span>${iconButton("sun", "theme", "切换明暗主题")}${iconButton("bell", "notifications", "查看通知", 'aria-haspopup="true" aria-expanded="false"')}<span class="avatar">${isUser ? "AC" : "AD"}</span></div></header><main class="main" id="main">${content}<footer class="footer"><span>© 2026 Model Bridge <span class="muted"> / </span> All models. One bridge.</span><span class="footer-links"><span>演示数据 · 2026.09.08</span><a href="landing.html">品牌首页</a><a href="${href("docs")}">帮助文档 ${I("external", "icon-sm")}</a></span></footer></main></div>`;
  }
  function pageHead(actions = "") {
    const p = pages[page] || pages.overview;
    return `<div class="page-head"><div><span class="eyebrow">${p[1]}</span><h1>${p[0]}</h1><p class="page-description">${p[2]}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
  }
  function metric(label, value, unit, change, hint, icon, featured = false) {
    return `<div class="metric ${featured ? "featured" : ""}"><div class="metric-label"><span>${label}</span>${I(icon)}</div><div class="metric-value">${value}<span class="unit">${unit}</span></div><div class="metric-foot"><span class="trend">${I("trend")}${change}</span><span>${hint}</span></div><div class="metric-mini" data-spark="${icon}" aria-hidden="true"></div></div>`;
  }
  function overview() {
    const multiplier = period === "week" ? 7 : period === "month" ? 30 : 1;
    const connected = [...new Set(state.accounts.map(a => a.provider))];
    const periods = [["today", "今日"], ["week", "近 7 天"], ["month", "近 30 天"]];
    return `<div class="overview-heading"><div><span class="eyebrow">YOUR MODEL WORKSPACE</span><h1>工作空间概览<span class="heading-dot">.</span></h1><p>欢迎回来，管理员。这里是你的模型网络运行情况。</p></div><div class="page-actions">${btn("导出报告", "export-overview", "download", false, 'class="hide-mobile"')}${btn("创建 API 密钥", "create-key", "plus", true)}</div></div>
      <div class="overview-meta"><div class="view-switch"><span class="active">运行概况</span><a href="stats.html">用量分析 ${I("arrow", "icon-sm")}</a></div><span class="refresh-time"><span class="dot"></span>演示数据 · 14:32 更新</span></div>
      <div class="metrics" id="overview-metrics">${overviewMetrics()}</div>
      <div class="overview-workspace">
        <div class="overview-primary">
          <section class="panel traffic-panel"><div class="panel-header"><div><h2>流量趋势</h2><p class="panel-subtitle">了解每个时段的请求分布</p></div><div class="segmented" aria-label="统计周期">${periods.map(([v,t])=>`<button data-action="period" data-value="${v}" class="${period===v?'active':''}" aria-pressed="${period===v}">${t}</button>`).join('')}</div></div>
            <div class="chart-topline"><div><span class="chart-overline">累计请求</span><strong class="chart-summary" id="traffic-total">${num(12846*multiplier)}<small>次</small></strong></div><div class="chart-legend"><span><i class="legend-dot current"></i>本期</span><span><i class="legend-dot outline"></i>上期</span></div></div>
            <div id="traffic-chart" class="traffic-chart" role="img" aria-label="演示请求流量折线图，本期与上期对比"></div><div class="chart-footer"><span>平均响应<strong>328 <small>ms</small></strong></span><span>请求成功率<strong>99.84<small>%</small></strong></span><a href="stats.html">查看详细分析 ${I('arrow','icon-sm')}</a></div>
          </section>
          <section class="panel table-panel recent-panel"><div class="panel-header"><div class="flex"><h2>最近请求</h2><span class="badge">最新 5 条</span></div><a class="link-button" href="stats.html">所有记录 ${I('arrow','icon-sm')}</a></div><div id="table-region"></div></section>
        </div>
        <aside class="overview-secondary" aria-label="服务状态与接入">
          <section class="gateway-card"><div class="gateway-label">${I('code')}<span>DEVELOPER QUICKSTART</span>${I('external','icon-sm')}</div><h2>让下一个想法，<br>接入你的模型。</h2><p>一个端点，连接所有模型服务。</p><div class="gateway-endpoint"><span>API BASE URL</span><div><code>http://localhost:3000/v1</code>${iconButton('copy','copy','复制 API 地址','data-copy="http://localhost:3000/v1"')}</div></div><a class="gateway-link" href="docs.html">阅读接入指南 ${I('arrow')}</a><div class="gateway-protocols"><span>OpenAI</span><span>Anthropic</span><span>Gemini</span></div></section>
          <section class="panel providers-panel"><div class="panel-header"><h2>服务商</h2><span class="badge">${connected.length} 已连接</span></div><div class="provider-list">${connected.map(p=>{const accounts=state.accounts.filter(a=>a.provider===p);const online=accounts.filter(a=>a.status==='正常');const latency=online.length?Math.round(online.reduce((n,a)=>n+a.latency,0)/online.length):0;return `<a class="provider-row" href="accounts.html">${providerAvatar(p)}<div class="provider-info"><div class="provider-name">${providers[p].name}</div><div class="provider-meta">${accounts.length} 个账户 · ${latency?latency+' ms':'暂无响应'}</div></div><span class="provider-connection ${online.length?'online':'offline'}" aria-label="${online.length?'运行正常':'暂无可用账户'}"><span class="dot"></span></span>${I('chevron','icon-sm muted')}</a>`;}).join('')}</div><a class="providers-manage" href="accounts.html">管理上游账户 ${I('arrow','icon-sm')}</a></section>
          <a class="developer-help" href="api-docs.html"><span class="help-icon">${I('docs')}</span><span><strong>需要一点帮助？</strong><small>查看 API 文档与调用示例</small></span>${I('arrow','icon-sm')}</a>
        </aside>
      </div>`;
  }
  function overviewMetrics() {
    const n = period === "week" ? 7 : period === "month" ? 30 : 1;
    return (
      metric("总请求数", num(12846 * n), "", "12.8%", "较上一周期", "stats") +
      metric(
        "Token 消耗",
        (24.6 * n).toFixed(1),
        "M",
        "8.2%",
        "较上一周期",
        "models",
      ) +
      metric("请求成功率", "99.84", "%", "0.12%", "较上一周期", "shield") +
      metric(
        "预估消耗",
        usd(18.42 * n),
        "",
        "5.4%",
        "较上一周期",
        "wallet",
        true,
      )
    );
  }
  function render() {
    charts.forEach((c) => c.dispose());
    charts = [];
    closeMenu();
    const contents = {
      overview: overview,
      accounts: accountsPage,
      "account-groups": groupsPage,
      keys: keysPage,
      users: usersPage,
      payments: paymentsPage,
      "redeem-codes": codesPage,
      "subscription-plans": plansPage,
      models: modelsPage,
      stats: statsPage,
      docs: docsPage,
      "api-docs": apiDocsPage,
      settings: settingsPage,
      "user-overview": walletPage,
      "user-models": modelsPage,
      "user-keys": keysPage,
      "user-usage": usagePage,
      "user-api-docs": apiDocsPage,
      landing: landingPage,
      login: loginPage,
      "accept-invite": invitePage,
    };
    const publicPage = ["landing", "login", "accept-invite"].includes(page);
    const markup = publicPage
      ? contents[page]()
      : shell((contents[page] || overview)());
    document.getElementById("app").innerHTML = markup.replaceAll(
      "http://localhost:3000",
      esc(state.settings.baseUrl.replace(/\/$/, "")),
    );
    document.title =
      (pages[page]?.[0] ||
        {
          landing: "连接模型与可能",
          login: "登录",
          "accept-invite": "接受邀请",
        }[page] ||
        "总览") + " · Model Bridge";
    const menu = document.querySelector("[data-action=sidebar]");
    if (menu) menu.classList.add("mobile-menu");
    if (page === "overview") renderTable();
    if (document.getElementById("data-table")) updateDataTable();
    if (document.getElementById("catalog-results")) updateModels();
    normalizeLinks();
    requestAnimationFrame(drawCharts);
  }
  function trafficOption() {
    const dark = state.settings.theme === "dark";
    const n = period === "today" ? 24 : period === "week" ? 7 : 30;
    const a = Array.from({ length: n }, (_, i) =>
      Math.round(
        (340 +
          Math.sin(i * 0.47 - 1) * 210 +
          Math.sin(i * 1.2) * 100 +
          (i > 9 && i < 20 ? 330 : 0)) *
          (page === "stats" && metricMode === "tokens" ? 1900 : 1),
      ),
    );
    const b = a.map((v, i) =>
      Math.round(v * 0.72 + Math.sin(i * 0.7) * 65 + 80),
    );
    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        backgroundColor: dark ? "#242633" : "#fff",
        borderColor: dark ? "#383b50" : "#e7e4f0",
        textStyle: { fontSize: 12, color: dark ? "#e8e3f8" : "#454255" },
        padding: 12,
      },
      grid: { left: 52, right: 27, top: 23, bottom: 36 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: a.map((_, i) =>
          period === "today"
            ? String(i).padStart(2, "0") + ":00"
            : period === "week"
              ? "09-" + String(i + 2).padStart(2, "0")
              : String(i + 1),
        ),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: dark ? "#9390a6" : "#a4a1b5",
          fontSize: 10,
          interval: period === "today" ? 3 : period === "week" ? 0 : 5,
          margin: 14,
        },
      },
      yAxis: {
        type: "value",
        splitNumber: 4,
        axisLabel: {
          color: dark ? "#9390a6" : "#a4a1b5",
          fontSize: 10,
          formatter: (v) =>
            v >= 1000000
              ? (v / 1000000).toFixed(1) + "M"
              : v >= 1000
                ? Math.round(v / 1000) + "k"
                : v,
        },
        splitLine: {
          lineStyle: { color: dark ? "#303144" : "#eeeef6", type: "dashed" },
        },
      },
      series: [
        {
          name: "上期",
          type: "line",
          data: b,
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#cbc6df", width: 1.5, type: "dashed" },
        },
        {
          name: "本期",
          type: "line",
          data: a,
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#8868e7", width: 2.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: dark ? "#7057b740" : "#b79ce44a" },
              { offset: 1, color: dark ? "#1d1c2a00" : "#f6f2ff00" },
            ]),
          },
        },
      ],
    };
  }
  function drawCharts() {
    if (!window.echarts) return;
    const el = document.getElementById("traffic-chart");
    if (el) {
      const c = echarts.init(el);
      c.setOption(trafficOption());
      charts.push(c);
    }
    const donut = document.getElementById("donut-chart");
    if (donut) {
      const c = echarts.init(donut);
      c.setOption({
        animation: false,
        color: ["#8264d9", "#b4a0e6", "#c6c8e5", "#e0daee"],
        title: {
          text: "12,846",
          subtext: "总请求数",
          left: "center",
          top: "35%",
          textStyle: {
            fontSize: 24,
            fontWeight: 500,
            color: state.settings.theme === "dark" ? "#e7e2f3" : "#3b3549",
          },
          subtextStyle: { fontSize: 10, color: "#9690a2" },
        },
        tooltip: { trigger: "item", formatter: "{b}: {d}%" },
        series: [
          {
            type: "pie",
            radius: ["60%", "77%"],
            center: ["50%", "49%"],
            label: { show: false },
            emphasis: { scaleSize: 4 },
            itemStyle: {
              borderColor: state.settings.theme === "dark" ? "#1b1d29" : "#fff",
              borderWidth: 4,
              borderRadius: 5,
            },
            data: [
              { name: "Anthropic", value: 42 },
              { name: "OpenAI", value: 33 },
              { name: "Google", value: 17 },
              { name: "DeepSeek", value: 8 },
            ],
          },
        ],
      });
      charts.push(c);
    }
    document.querySelectorAll("[data-spark]").forEach((el, i) => {
      const c = echarts.init(el);
      c.setOption({
        animation: false,
        grid: { left: 0, right: 0, top: 3, bottom: 3 },
        xAxis: {
          show: false,
          type: "category",
          data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        },
        yAxis: { show: false, type: "value", min: 0 },
        series: [
          {
            type: "line",
            data: [5, 9, 7, 11, 8, 12, 10, 18, 14, 19, 22].map(
              (v, j) => v + ((j * i) % 8),
            ),
            symbol: "none",
            smooth: true,
            lineStyle: { color: i === 3 ? "#c2b2ed" : "#a592d2", width: 1.6 },
            areaStyle: { color: i === 3 ? "#c0a8f515" : "#aa93e01d" },
          },
        ],
      });
      charts.push(c);
    });
  }
  function renderTable() {
    const el = document.getElementById("table-region");
    if (!el) return;
    el.innerHTML = `<div class="table-scroll"><table><thead><tr><th>模型 / 服务商</th><th>API 密钥</th><th>Token 用量</th><th>费用</th><th>响应耗时</th><th>状态</th><th>请求时间</th><th></th></tr></thead><tbody>${activity
      .slice(0, 5)
      .map(
        (r) =>
          `<tr><td><div class="flex">${providerAvatar(r.provider)}<strong class="mono">${r.model}</strong></div></td><td>${r.key}</td><td class="mono">${num(r.tokens)}</td><td class="mono">${usd(r.cost, 4)}</td><td class="mono">${r.latency} ms</td><td>${badge(r.status, r.status === "成功" ? "green" : "red")}</td><td class="mono muted">${r.time.slice(6)}</td><td>${iconButton("chevron", "request-detail", "查看请求详情", `data-id="${r.id}"`)}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><div class="pagination"><span>显示最近 5 条请求 · 演示数据</span><a class="link-button" href="stats.html">所有请求 ${I("arrow", "icon-sm")}</a></div>`;
  }
  const groupOptions = () => state.groups.map((g) => g.name);
  const statusTone = (s) =>
    ["失败", "已停用", "已取消"].includes(s)
      ? "red"
      : ["冷却中", "待支付", "未兑换", "待激活"].includes(s)
        ? "orange"
        : "green";
  function quota(used, limit, percent = false) {
    const value = limit ? Math.min((used / limit) * 100, 100) : 0;
    return `<div class="quota"><div class="progress-label"><span>${percent ? used + "%" : usd(used)}</span><span>${percent ? "已使用" : limit ? usd(limit) : "不限"}</span></div><div class="progress ${value > 85 ? "orange" : ""}"><span style="width:${value}%"></span></div></div>`;
  }
  const avatar = (name) =>
    `<span class="avatar">${esc(
      name
        .split(" ")
        .map((v) => v[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    )}</span>`;
  const rowMenu = (type, id) =>
    iconButton(
      "dots",
      "row-menu",
      "更多操作",
      `data-type="${type}" data-id="${esc(id)}" aria-haspopup="true" aria-expanded="false"`,
    );
  const tableDefinitions = {
    accounts: {
      label: "上游账户",
      search: "搜索账户名称…",
      filters: [
        [
          "provider",
          "全部服务商",
          Object.entries(providers).map(([k, v]) => [k, v.name]),
        ],
        ["status", "全部状态", ["正常", "冷却中", "已停用"]],
      ],
      data: () => state.accounts,
      columns: [
        [
          "账户",
          (r) =>
            `<div class="flex">${providerAvatar(r.provider)}<div><strong>${esc(r.name)}</strong><div class="cell-sub">${providers[r.provider]?.name || "自定义"}</div></div>`,
        ],
        ["认证方式", (r) => `<span class="badge">${esc(r.auth)}</span>`],
        ["状态", (r) => badge(r.status, statusTone(r.status))],
        ["账户分组", (r) => esc(r.group)],
        ["额度使用", (r) => quota(r.used, 100, true)],
        ["优先级", (r) => `<span class="mono">${r.priority}</span>`],
        [
          "响应耗时",
          (r) =>
            `<span class="mono">${r.latency ? r.latency + " ms" : "—"}</span>`,
        ],
        ["", (r) => rowMenu("accounts", r.id)],
      ],
    },
    keys: {
      label: "API 密钥",
      search: "搜索密钥或归属用户…",
      filters: [
        ["status", "全部状态", ["启用", "已停用"]],
        ["group", "全部分组", groupOptions],
      ],
      data: () =>
        isUser ? state.keys.filter((k) => k.owner === "Alex Chen") : state.keys,
      columns: [
        [
          "密钥名称",
          (r) =>
            `<strong>${esc(r.name)}</strong><div class="cell-sub">${esc(r.owner)}</div>`,
        ],
        [
          "API Key",
          (r) =>
            `<div class="flex"><span class="mono">mb-demo-····${esc(r.key.slice(-6))}</span>${iconButton("copy", "copy", "复制演示密钥", `data-copy="${esc(r.key)}"`)}</div>`,
        ],
        ["账户分组", (r) => esc(r.group)],
        ["额度使用", (r) => quota(r.used, r.limit)],
        ["请求数", (r) => `<span class="mono">${num(r.requests)}</span>`],
        ["状态", (r) => badge(r.status, statusTone(r.status))],
        ["", (r) => rowMenu("keys", r.id)],
      ],
    },
    users: {
      label: "用户钱包",
      search: "搜索姓名或邮箱…",
      filters: [["status", "全部状态", ["正常", "已停用", "待激活"]]],
      data: () => state.users,
      columns: [
        [
          "用户",
          (r) =>
            `<div class="flex">${avatar(r.name)}<div><strong>${esc(r.name)}</strong><div class="cell-sub">${esc(r.email)}</div></div>`,
        ],
        [
          "钱包余额",
          (r) =>
            `<strong class="mono ${r.balance <= 0 ? "negative" : ""}">${usd(r.balance)}</strong>`,
        ],
        ["订阅套餐", (r) => esc(r.plan)],
        ["密钥", (r) => `<span class="mono">${r.keys}</span>`],
        ["累计请求", (r) => `<span class="mono">${num(r.requests)}</span>`],
        ["累计消耗", (r) => `<span class="mono">${usd(r.cost)}</span>`],
        ["状态", (r) => badge(r.status, statusTone(r.status))],
        ["", (r) => rowMenu("users", r.id)],
      ],
    },
    payments: {
      label: "充值订单",
      search: "搜索订单号或用户…",
      filters: [
        ["status", "全部状态", ["已入账", "待支付", "已取消"]],
        ["channel", "全部通道", ["支付宝", "手动入账"]],
      ],
      data: () =>
        isUser
          ? state.payments.filter((r) => r.user === "Alex Chen")
          : state.payments,
      columns: [
        [
          "订单号",
          (r) =>
            `<strong class="mono">${esc(r.id)}</strong><div class="cell-sub">2026-${esc(r.time)}</div>`,
        ],
        ["用户", (r) => esc(r.user)],
        ["充值金额", (r) => `<strong class="mono">${usd(r.amount)}</strong>`],
        ["支付通道", (r) => esc(r.channel)],
        ["状态", (r) => badge(r.status, statusTone(r.status))],
        ["备注", (r) => esc(r.note)],
        ["", (r) => rowMenu("payments", r.id)],
      ],
    },
    codes: {
      label: "兑换码",
      search: "搜索兑换码或批次…",
      filters: [["status", "全部状态", ["未兑换", "已兑换"]]],
      data: () => state.codes,
      columns: [
        [
          "兑换码",
          (r) =>
            `<div class="flex"><strong class="mono">${esc(r.code)}</strong>${iconButton("copy", "copy", "复制演示兑换码", `data-copy="${esc(r.code)}"`)}</div><div class="cell-sub">${esc(r.note)}</div>`,
        ],
        ["面额", (r) => `<strong class="mono">${usd(r.value)}</strong>`],
        ["状态", (r) => badge(r.status, statusTone(r.status))],
        ["批次", (r) => `<span class="mono">${esc(r.batch)}</span>`],
        ["有效期", (r) => `<span class="mono">${esc(r.expiry)}</span>`],
        ["兑换用户", (r) => esc(r.user)],
        ["", (r) => rowMenu("codes", r.id)],
      ],
    },
    activity: {
      label: "请求记录",
      search: "搜索模型、密钥或请求 ID…",
      filters: [
        [
          "provider",
          "全部服务商",
          Object.entries(providers).map(([k, v]) => [k, v.name]),
        ],
        ["status", "全部状态", ["成功", "失败"]],
      ],
      data: () => activity,
      columns: [
        [
          "模型",
          (r) =>
            `<div class="flex">${providerAvatar(r.provider)}<div><strong class="mono">${r.model}</strong><div class="cell-sub">${r.id}</div></div>`,
        ],
        ["API 密钥", (r) => r.key],
        ["Tokens", (r) => `<span class="mono">${num(r.tokens)}</span>`],
        ["费用", (r) => `<span class="mono">${usd(r.cost, 4)}</span>`],
        ["耗时", (r) => `<span class="mono">${r.latency} ms</span>`],
        ["状态", (r) => badge(r.status, statusTone(r.status))],
        ["时间", (r) => `<span class="mono">${r.time}</span>`],
        [
          "",
          (r) =>
            iconButton(
              "chevron",
              "request-detail",
              "查看请求详情",
              `data-id="${r.id}"`,
            ),
        ],
      ],
    },
    wallet: {
      label: "钱包流水",
      search: "搜索流水类型或备注…",
      filters: [
        ["type", "全部类型", ["账户充值", "模型调用", "兑换码", "订阅购买"]],
      ],
      data: () => state.walletEntries,
      columns: [
        ["时间", (r) => `<span class="mono">2026-${esc(r.time)}</span>`],
        ["类型", (r) => esc(r.type)],
        [
          "金额",
          (r) =>
            `<strong class="mono ${r.amount >= 0 ? "positive" : ""}">${r.amount > 0 ? "+" : ""}${usd(r.amount, Math.abs(r.amount) < 1 ? 4 : 2)}</strong>`,
        ],
        ["变动后余额", (r) => `<span class="mono">${usd(r.balance)}</span>`],
        ["备注", (r) => esc(r.note)],
      ],
    },
  };
  function tableControls(type) {
    const d = tableDefinitions[type];
    if (currentTable?.type !== type)
      currentTable = { type, query: "", filters: {}, page: 1 };
    return `<div class="table-toolbar"><div class="filters"><label class="search-field">${I("search")}<input type="search" data-table-search aria-label="${d.search}" placeholder="${d.search}" value="${esc(currentTable.query)}"></label>${d.filters
      .map(
        ([key, label, values]) =>
          `<select data-table-filter="${key}" aria-label="${label}"><option value="">${label}</option>${(typeof values ===
          "function"
            ? values()
            : values
          )
            .map((v) => {
              const [value, text] = Array.isArray(v) ? v : [v, v];
              return `<option value="${esc(value)}" ${currentTable.filters[key] === value ? "selected" : ""}>${esc(text)}</option>`;
            })
            .join("")}</select>`,
      )
      .join(
        "",
      )}</div>${btn("导出", "export-table", "download", false, 'aria-label="导出当前筛选数据"')}</div><div id="data-table"></div>`;
  }
  function filteredData() {
    const def = tableDefinitions[currentTable.type];
    const q = currentTable.query.trim().toLowerCase();
    return def
      .data()
      .filter(
        (r) =>
          (!q ||
            Object.values(r).some((v) =>
              String(v).toLowerCase().includes(q),
            )) &&
          Object.entries(currentTable.filters).every(
            ([k, v]) => !v || String(r[k]) === v,
          ),
      );
  }
  function updateDataTable() {
    const el = document.getElementById("data-table");
    if (!el || !currentTable) return;
    const d = tableDefinitions[currentTable.type];
    const rows = filteredData();
    const size = 6;
    const max = Math.max(1, Math.ceil(rows.length / size));
    currentTable.page = Math.min(currentTable.page, max);
    const start = (currentTable.page - 1) * size;
    el.innerHTML = `<div class="table-scroll"><table><caption class="sr-only">${d.label}，共 ${rows.length} 条演示记录</caption><thead><tr>${d.columns.map(([title]) => `<th scope="col">${title || '<span class="sr-only">操作</span>'}</th>`).join("")}</tr></thead><tbody>${
      rows.length
        ? rows
            .slice(start, start + size)
            .map(
              (r) =>
                `<tr>${d.columns.map(([, render], i) => `<td ${i === d.columns.length - 1 ? 'class="table-actions"' : ""}>${render(r)}</td>`).join("")}</tr>`,
            )
            .join("")
        : `<tr><td colspan="${d.columns.length}"><div class="empty-state">${I("search")}<h3>没有找到匹配的记录</h3><p>试试其他关键词，或清除筛选条件。</p>${btn("清除筛选", "clear-filters", "refresh")}</div></td></tr>`
    }</tbody></table></div><div class="pagination"><span>共 ${rows.length} 条记录${rows.length ? ` · 显示 ${start + 1}–${Math.min(start + size, rows.length)} 条` : ""}</span><div class="page-numbers"><button class="btn" data-action="paginate" data-value="${currentTable.page - 1}" ${currentTable.page === 1 ? "disabled" : ""} aria-label="上一页">${I("chevron", "icon-sm rotate")}</button>${Array.from({ length: max }, (_, i) => `<button class="btn ${i + 1 === currentTable.page ? "active" : ""}" data-action="paginate" data-value="${i + 1}" aria-label="第 ${i + 1} 页" ${i + 1 === currentTable.page ? 'aria-current="page"' : ""}>${i + 1}</button>`).join("")}<button class="btn" data-action="paginate" data-value="${currentTable.page + 1}" ${currentTable.page === max ? "disabled" : ""} aria-label="下一页">${I("chevron", "icon-sm")}</button></div></div>`;
  }
  function accountsPage() {
    const enabled = state.accounts.filter((a) => a.status === "正常").length;
    return (
      pageHead(
        btn("导入账户", "import-accounts", "download") +
          btn("添加账户", "create-account", "plus", true),
      ) +
      `<div class="account-summary-grid"><div class="summary-number"><span class="muted">账户总数</span><strong>${state.accounts.length}<small>个</small></strong></div><div class="summary-number"><span><span class="dot positive"></span> 正常运行</span><strong>${enabled}<small>个</small></strong></div><div class="summary-number"><span><span class="dot" style="color:#c8a05e"></span> 冷却中</span><strong>${state.accounts.filter((a) => a.status === "冷却中").length}<small>个</small></strong></div><div class="summary-number"><span class="muted">连接服务商</span><strong>${new Set(state.accounts.map((a) => a.provider)).size}<small>家</small></strong></div></div><section class="panel"><div class="panel-header"><div><h2>账户资源池</h2><p class="panel-subtitle">按优先级调度，相同优先级使用最近最少调用的账户</p></div>${btn("健康检查", "check-all", "refresh")}</div>${tableControls("accounts")}</section><div class="inline-note mt">${I("info")}账户达到配额阈值后将暂停调度，窗口重置后恢复。<a class="link-button" href="settings.html">调整调度策略 ${I("arrow", "icon-sm")}</a></div>`
    );
  }
  function keysPage() {
    return (
      pageHead(btn("创建密钥", "create-key", "plus", true)) +
      `<div class="quick-connect">${I("keys")}<div class="quick-connect-copy"><h3>你的应用，从这里接入</h3><p>使用 Bearer Token 鉴权，兼容熟悉的 SDK</p></div><div class="endpoint"><span>http://localhost:3000/v1</span>${iconButton("copy", "copy", "复制 API 地址", 'data-copy="http://localhost:3000/v1"')}</div><a class="link-button" href="${href("api-docs")}">API 文档 ${I("arrow", "icon-sm")}</a></div><section class="panel"><div class="account-stats"><div>全部密钥 <strong>${tableDefinitions.keys.data().length}</strong></div><div><span class="dot positive"></span>已启用 <strong>${tableDefinitions.keys.data().filter((k) => k.status === "启用").length}</strong></div><div>本月消耗 <strong>${usd(tableDefinitions.keys.data().reduce((n, k) => n + k.used, 0))}</strong></div></div>${tableControls("keys")}</section><div class="inline-note mt">${I("shield")}每个应用使用独立密钥，设置合适的额度与访问范围。此处密钥均带有 <code>mb-demo-</code> 前缀，仅用于界面演示。</div>`
    );
  }
  function groupsPage() {
    return (
      pageHead(btn("创建分组", "create-group", "plus", true)) +
      `<div class="resource-grid">${state.groups
        .map((g) => {
          const members = state.accounts.filter((a) => a.group === g.name);
          const keys = state.keys.filter((k) => k.group === g.name);
          return `<section class="panel group-card"><div class="group-top"><span class="group-icon">${I("account-groups")}</span><div><h2>${esc(g.name)}</h2><small class="muted">${g.id === "group-3" ? "DEFAULT POOL" : "CUSTOM POOL"}</small></div><span style="margin-left:auto">${rowMenu("groups", g.id)}</span></div><p>${esc(g.description)}</p><div class="group-stats"><div><strong>${members.length}</strong><small>成员账户</small></div><div><strong>${keys.length}</strong><small>绑定密钥</small></div><div><strong>${g.rate}<small>×</small></strong><small>计费倍率</small></div></div><div class="group-bottom"><div class="avatar-stack">${[...new Set(members.map((m) => m.provider))].map(providerAvatar).join("") || '<span class="muted">暂无成员</span>'}</div><button class="link-button" data-action="group-members" data-id="${g.id}">管理成员 ${I("arrow", "icon-sm")}</button></div></section>`;
        })
        .join(
          "",
        )}</div><div class="inline-note mt">${I("info")}绑定分组的密钥只使用对应账户池；未绑定分组的密钥使用默认账户池。</div>`
    );
  }
  function usersPage() {
    return (
      pageHead(btn("邀请用户", "invite-user", "plus", true)) +
      `<div class="metrics">${metric("用户总数", state.users.length, "", "+2", "本周新增", "users")}${metric("钱包总余额", usd(state.users.reduce((n, u) => n + u.balance, 0)), "", "12.4%", "较上月", "wallet")}${metric("活跃订阅", state.users.filter((u) => u.plan !== "无订阅").length, "", "+1", "本周新增", "subscription-plans")}${metric("累计消耗", usd(state.users.reduce((n, u) => n + u.cost, 0)), "", "8.6%", "较上月", "stats", true)}</div><section class="panel">${tableControls("users")}</section>`
    );
  }
  function paymentsPage() {
    return (
      pageHead(btn("导出订单", "export-page", "download")) +
      `<div class="metrics">${metric("累计入账", usd(state.payments.filter((p) => p.status === "已入账").reduce((n, p) => n + p.amount, 0)), "", "18.2%", "较上月", "wallet")}${metric("已入账订单", state.payments.filter((p) => p.status === "已入账").length, "", "+3", "本月新增", "payments")}${metric("待支付", state.payments.filter((p) => p.status === "待支付").length, "", "—", "等待付款", "clock")}${metric("支付成功率", "98.6", "%", "0.4%", "较上月", "shield")}</div><section class="panel">${tableControls("payments")}</section>`
    );
  }
  function codesPage() {
    return (
      pageHead(btn("生成兑换码", "create-codes", "plus", true)) +
      `<div class="account-summary-grid"><div class="summary-number"><span class="muted">全部兑换码</span><strong>${state.codes.length}<small>张</small></strong></div><div class="summary-number"><span class="muted">待兑换</span><strong>${state.codes.filter((c) => c.status === "未兑换").length}<small>张</small></strong></div><div class="summary-number"><span class="muted">已兑换</span><strong>${state.codes.filter((c) => c.status === "已兑换").length}<small>张</small></strong></div><div class="summary-number"><span class="muted">待兑换面额</span><strong>${usd(state.codes.filter((c) => c.status === "未兑换").reduce((n, c) => n + c.value, 0))}</strong></div></div><section class="panel">${tableControls("codes")}</section>`
    );
  }
  function planCards(buy = false) {
    return state.plans
      .filter((p) => !buy || p.status === "已上架")
      .map(
        (p, i) =>
          `<section class="panel plan-card ${i === 1 ? "featured-plan" : ""}"><div class="between"><span class="plan-tag">${p.tag}</span>${i === 1 ? '<span class="badge green">推荐选择</span>' : badge(p.status)}</div><h2>${esc(p.name)}</h2><p class="plan-desc">${esc(p.description)}</p><div class="plan-price">${usd(p.price, 0)}<small> / ${p.days} 天</small></div>${btn(buy ? "选择此套餐" : "编辑套餐", buy ? "buy-plan" : "edit-plan", buy ? "arrow" : "edit", i === 1, `data-id="${p.id}"`)}<ul class="plan-features"><li>${I("check")}每日额度 ${usd(p.daily)}</li><li>${I("check")}每周额度 ${usd(p.weekly)}</li><li>${I("check")}每月额度 ${usd(p.monthly)}</li><li>${I("check")}${esc(p.group)}账户池</li><li>${I("check")}支持池内全部可用模型</li></ul>${!buy ? `<div class="between mt"><span class="muted" style="font-size:11px">${esc(p.status)}</span>${rowMenu("plans", p.id)}</div>` : ""}</section>`,
      )
      .join("");
  }
  function plansPage() {
    return (
      pageHead(btn("创建套餐", "create-plan", "plus", true)) +
      `<div class="resource-grid">${planCards()}</div><div class="inline-note mt">${I("info")}日、周、月额度分别计算；到达任一额度上限后，等待对应周期重置。套餐价格为演示数据。</div>`
    );
  }
  function modelsPage() {
    return (
      pageHead(
        `<a class="btn" href="${href("api-docs")}">${I("code")}API 文档</a>`,
      ) +
      `<div class="page-subnav"><div class="tabs"><span class="tab active">全部模型 <span class="count">${window.BRIDGE_CATALOG.models.length}</span></span></div><span class="subnav-note">价格为仓库目录示例 · USD / 1M tokens</span></div><div class="catalog-toolbar"><label class="search-field catalog-search">${I("search")}<input type="search" data-model-search placeholder="搜索模型名称或能力…" aria-label="搜索模型" value="${esc(modelQuery)}"></label><select data-model-provider aria-label="按服务商筛选"><option>全部服务商</option>${Object.entries(
        providers,
      )
        .map(
          ([id, p]) =>
            `<option value="${id}" ${modelProvider === id ? "selected" : ""}>${p.name}</option>`,
        )
        .join(
          "",
        )}</select></div><div class="filter-chips" aria-label="模型能力筛选">${["全部模型", "推理", "编程", "多模态", "图片生成", "经济高效"].map((c) => `<button class="filter-chip ${c === modelCategory ? "active" : ""}" data-action="model-category" data-value="${c}" aria-pressed="${c === modelCategory}">${c}</button>`).join("")}</div><div class="between mb"><span class="muted" id="model-count" style="font-size:11px"></span><span class="muted" style="font-size:11px">选择模型查看参数与调用方式</span></div><div id="catalog-results" class="catalog-grid"></div>`
    );
  }
  function updateModels() {
    const categoryPatterns = {
      推理: /推理|reasoning|思考/,
      编程: /编程|coding|代码|code/i,
      多模态: /多模态|vision|视觉|图像理解/,
      图片生成: /图片生成|图像生成|image|生图/i,
      经济高效: /经济|轻量|高性价比|低成本|flash|mini|haiku/i,
    };
    const models = window.BRIDGE_CATALOG.models.filter(
      (m) =>
        (modelProvider === "全部服务商" || m.provider === modelProvider) &&
        (!modelQuery ||
          [m.name, m.id, m.description, ...m.tags]
            .join(" ")
            .toLowerCase()
            .includes(modelQuery.toLowerCase())) &&
        (modelCategory === "全部模型" ||
          categoryPatterns[modelCategory].test(
            [m.name, m.description, ...m.tags, ...m.categories].join(" "),
          )),
    );
    document.getElementById("model-count").textContent =
      `找到 ${models.length} 个模型 · 演示目录`;
    document.getElementById("catalog-results").innerHTML = models.length
      ? models
          .map(
            (m) =>
              `<button class="model-card" data-action="model-detail" data-id="${esc(m.id)}"><span class="model-card-header"><span class="flex">${providerAvatar(m.provider)}<span class="model-provider-label">${providers[m.provider]?.name}</span></span>${m.badge ? `<span class="badge ${m.badge === "new" ? "blue" : "green"}">${m.badge === "new" ? "NEW" : "推荐"}</span>` : I("external", "icon-sm muted")}</span><strong class="model-title">${esc(m.name)}</strong><span class="model-id">${esc(m.id)}</span><span class="model-description">${esc(m.description)}</span><span class="model-tags">${m.tags
                .slice(0, 4)
                .map((t) => `<span>${esc(t)}</span>`)
                .join(
                  "",
                )}</span><span class="model-prices"><span>输入 / 1M<strong>${usd(m.inputPrice)}</strong></span><span>输出 / 1M<strong>${usd(m.outputPrice)}</strong></span><span>上下文<strong>${esc(m.context)}</strong></span></span></button>`,
          )
          .join("")
      : `<div class="empty-state" style="grid-column:1/-1">${I("search")}<h3>没有找到相关模型</h3><p>试试其他关键词，或查看全部模型。</p>${btn("清除筛选", "clear-models", "refresh")}</div>`;
  }
  function statsPage() {
    return (
      pageHead(
        `<select data-stats-period aria-label="选择统计周期"><option value="today">今日 · 09 月 08 日</option><option value="week" ${period === "week" ? "selected" : ""}>最近 7 天</option><option value="month" ${period === "month" ? "selected" : ""}>最近 30 天</option></select>${btn("导出数据", "export-overview", "download")}`,
      ) +
      `<div class="metrics" id="overview-metrics">${overviewMetrics()}</div><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>用量趋势</h2><p class="panel-subtitle">按时间了解请求与 Token 消耗</p></div><div class="segmented">${[
        ["requests", "请求数"],
        ["tokens", "Tokens"],
      ]
        .map(
          ([v, t]) =>
            `<button data-action="chart-mode" data-value="${v}" class="${metricMode === v ? "active" : ""}" aria-pressed="${metricMode === v}">${t}</button>`,
        )
        .join(
          "",
        )}</div></div><div id="traffic-chart" class="stat-chart" role="img" aria-label="用量趋势图"></div></section><section class="panel"><div class="panel-header"><div><h2>服务商占比</h2><p class="panel-subtitle">按请求数分布 · 演示数据</p></div></div><div id="donut-chart" class="donut-chart" role="img" aria-label="Anthropic 42%，OpenAI 33%，Google 17%，DeepSeek 8%"></div><div class="chart-legend" style="justify-content:center;padding:0 15px 24px;flex-wrap:wrap">${[
        ["#8264d9", "Anthropic"],
        ["#b4a0e6", "OpenAI"],
        ["#c6c8e5", "Google"],
        ["#e0daee", "DeepSeek"],
      ]
        .map(
          ([color, name]) =>
            `<span><i class="legend-dot" style="background:${color}"></i>${name}</span>`,
        )
        .join(
          "",
        )}</div></section></div><section class="panel"><div class="panel-header" style="padding-bottom:5px"><h2>请求明细</h2><span class="muted" style="font-size:11px">显示 32 条演示请求</span></div>${tableControls("activity")}</section>`
    );
  }
  function walletPage() {
    return (
      pageHead(
        btn("兑换码充值", "redeem", "redeem-codes") +
          btn("账户充值", "recharge", "plus", true),
      ) +
      `<div class="two-column"><section class="panel wallet-card"><div class="between"><span class="eyebrow">YOUR BALANCE</span>${I("wallet")}</div><div><p style="font-size:12px;color:#aaa4c0;margin-top:18px">钱包可用余额</p><div class="wallet-value"><small>USD</small>${state.wallet.toFixed(2)}</div><div class="flex">${btn("充值余额", "recharge", "plus", false, 'class="btn-light"')}<button class="btn btn-ghost" data-action="wallet-history">查看流水 ${I("arrow", "icon-sm")}</button></div></div><div class="wallet-footer"><span>按实际用量扣费</span><span>Alex Chen · 个人账户</span></div></section><div class="wallet-side">${metric("今日请求", "1,284", "", "18.2%", "较昨日", "stats")}${metric("今日消耗", "$2.86", "", "6.4%", "较昨日", "wallet")}${metric("使用 Tokens", "2.46", "M", "12.6%", "较昨日", "models")}${metric("活跃密钥", state.keys.filter((k) => k.owner === "Alex Chen" && k.status === "启用").length, "", "—", "当前已启用", "keys")}</div></div><div class="subscription-strip"><div class="flex"><span class="group-icon">${I("subscription-plans")}</span><div><h3>${esc(state.subscription)}</h3><p>当前订阅 · 演示周期剩余 ${state.subscriptionDaysRemaining ?? 22} 天</p></div></div>${quota(state.subscriptionUsed ?? 32.4, state.plans.find((p) => p.name === state.subscription)?.monthly || 120)}<button class="link-button" data-action="plan-store">查看套餐 ${I("arrow", "icon-sm")}</button></div><section class="panel"><div class="panel-header"><h2>最近调用</h2><a class="link-button" href="user-usage.html">查看全部 ${I("arrow", "icon-sm")}</a></div>${tableControls("activity")}</section>`
    );
  }
  let usageType = "activity";
  function usagePage() {
    return (
      pageHead(btn("导出记录", "export-page", "download")) +
      `<div class="page-subnav"><div class="tabs">${[
        ["activity", "调用记录"],
        ["wallet", "钱包流水"],
        ["payments", "充值订单"],
      ]
        .map(
          ([v, t]) =>
            `<button class="tab ${usageType === v ? "active" : ""}" data-action="usage-tab" data-value="${v}">${t}</button>`,
        )
        .join(
          "",
        )}</div><span class="subnav-note">所有金额以 USD 计价</span></div><section class="panel">${tableControls(usageType)}</section>`
    );
  }
  function field(
    name,
    label,
    value = "",
    type = "text",
    hint = "",
    attrs = "",
  ) {
    return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>${hint ? `<small>${hint}</small>` : ""}</label>`;
  }
  function selectField(name, label, values, selected = "", hint = "") {
    return `<label class="field"><span>${label}</span><select name="${name}">${values
      .map((v) => {
        const [value, text] = Array.isArray(v) ? v : [v, v];
        return `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(text)}</option>`;
      })
      .join("")}</select>${hint ? `<small>${hint}</small>` : ""}</label>`;
  }
  const switchField = (name, title, description, checked) =>
    `<div class="switch-row"><div><strong>${title}</strong><p>${description}</p></div><label class="switch"><input type="checkbox" role="switch" name="${name}" ${checked ? "checked" : ""} aria-label="${title}"><span></span></label></div>`;
  const formActions = (text = "保存", note = "") =>
    `<div class="form-actions">${note ? `<span class="muted">${note}</span>` : ""}<button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${text} ${I("arrow", "icon-sm")}</button></div>`;
  function settingsPage() {
    const s = state.settings;
    const tabs = [
      ["general", "常规设置", "settings"],
      ["registration", "用户注册", "users"],
      ["scheduling", "调度与配额", "accounts"],
      ["security", "安全设置", "shield"],
      ["account", "管理员账户", "keys"],
      ["about", "关于系统", "info"],
    ];
    let body = "";
    if (settingsTab === "general")
      body = `<div class="form-grid">${field("name", "站点名称", s.name, "text", "", 'required maxlength="60"')}${selectField(
        "timezone",
        "默认时区",
        [
          ["Asia/Shanghai", "中国标准时间 · UTC+8"],
          ["UTC", "协调世界时 · UTC"],
        ],
        s.timezone,
      )}<div class="field full">${field("baseUrl", "API 基础地址", s.baseUrl, "url", "站点根地址，不包含 /v1；用于文档和复制入口。", "required")}</div>${selectField(
        "theme",
        "界面主题",
        [
          ["light", "浅色"],
          ["dark", "深色"],
        ],
        s.theme,
      )}${field("email", "联系邮箱", s.email, "email", "", "required")}</div>`;
    if (settingsTab === "registration")
      body =
        switchField(
          "registration",
          "开放用户注册",
          "允许访客从登录页面注册个人账户。",
          s.registration,
        ) +
        switchField(
          "inviteOnly",
          "仅允许邀请加入",
          "关闭公开注册后，仍可通过邀请链接加入。",
          s.inviteOnly,
        ) +
        `<div class="inline-note mt">${I("info")}注册与邀请设置仅保存到此浏览器的演示数据。</div>`;
    if (settingsTab === "scheduling")
      body = `<div class="form-grid">${selectField("strategy", "账户调度策略", ["优先级 + 最近最少使用", "轮询", "最低用量优先"], s.strategy)}${field("retry", "失败重试次数", s.retry, "number", "", 'min="0" max="10" required')}</div>${switchField("quotaPause", "配额自动停调", "账户用量达到阈值后暂停，窗口重置后恢复。", s.quotaPause)}<div class="form-grid mt">${field("threshold", "停调阈值（%）", s.threshold, "number", "", 'min="1" max="100" required')}${field("cooldown", "异常冷却时间（分钟）", s.cooldown, "number", "", 'min="1" max="120" required')}</div>`;
    if (settingsTab === "security")
      body =
        switchField(
          "securityHeaders",
          "安全响应头",
          "为 API 与管理面板附加安全相关响应头。",
          s.securityHeaders,
        ) +
        switchField(
          "urlGuard",
          "上游 URL 检查",
          "检查自定义上游地址的协议与目标范围。",
          s.urlGuard,
        ) +
        `<div class="form-grid mt">${field("rateLimit", "面板每分钟请求上限", s.rateLimit, "number", "", 'min="1" required')}${field("writeLimit", "敏感操作每分钟上限", s.writeLimit, "number", "", 'min="1" required')}</div>`;
    if (settingsTab === "account")
      body = `<div class="flex mb">${avatar("Admin")}<div><h3>管理员</h3><small class="muted">admin@example.test · 演示账户</small></div></div><div class="form-grid">${field("currentPassword", "当前密码", "", "password", "演示任意密码，不会发送或保存。", 'autocomplete="current-password" required')}${field("newPassword", "新密码", "", "password", "至少 8 位字符。", 'autocomplete="new-password" minlength="8" required')}${field("confirmPassword", "确认新密码", "", "password", "", 'autocomplete="new-password" minlength="8" required')}</div>`;
    if (settingsTab === "about")
      body = `<div class="flex mb"><img src="assets/favicon.svg" alt="" width="48" height="48"><div><h2>Model Bridge</h2><p class="muted" style="font-size:11px">Version 0.1.183 · HTML Design Edition</p></div></div><p class="secondary" style="font-size:12px;line-height:2">把不同服务商的模型，连接到统一的 API。此版本为完整界面设计演示，数据存储在当前浏览器中。</p><div class="divider"></div><div class="detail-list"><div class="detail-item"><small>数据模式</small><strong>本地模拟数据</strong></div><div class="detail-item"><small>界面版本</small><strong>2026.09.08</strong></div><div class="detail-item"><small>当前存储</small><strong>此浏览器</strong></div><div class="detail-item"><small>静态交付</small><strong>HTML / CSS / JavaScript</strong></div></div><div class="divider"></div>${btn("恢复初始演示数据", "reset-demo", "refresh")}`;
    return (
      pageHead() +
      `<div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${tabs.map(([v, t, i]) => `<button class="${settingsTab === v ? "active" : ""}" data-action="settings-tab" data-value="${v}" ${settingsTab === v ? 'aria-current="page"' : ""}>${I(i, "icon-sm")}${t}</button>`).join("")}</nav><section class="panel settings-panel"><div class="panel-header"><div><h2>${tabs.find((t) => t[0] === settingsTab)[1]}</h2><p class="panel-subtitle">${settingsTab === "about" ? "关于此界面演示" : "更改将在保存后应用于本地演示"}</p></div></div><form class="settings-form" data-form="settings"><div class="form-error" role="alert"></div>${body}${settingsTab !== "about" ? `<div class="form-actions"><span class="muted">仅影响本地演示</span>${btn("还原本页", "reload-settings")}<button class="btn btn-primary" type="submit">${I("check")}保存更改</button></div>` : ""}</form></section></div>`
    );
  }
  const snippets = {
    curl: `curl http://localhost:3000/v1/chat/completions \\\n  -H "Authorization: Bearer $MODEL_BRIDGE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "gpt-5.5",\n    "messages": [\n      { "role": "user", "content": "你好，Model Bridge！" }\n    ]\n  }'`,
    python: `from openai import OpenAI\nimport os\n\nclient = OpenAI(\n    base_url="http://localhost:3000/v1",\n    api_key=os.environ["MODEL_BRIDGE_API_KEY"]\n)\n\nresponse = client.chat.completions.create(\n    model="gpt-5.5",\n    messages=[{"role": "user", "content": "你好！"}]\n)\nprint(response.choices[0].message.content)`,
    node: `import OpenAI from 'openai';\n\nconst client = new OpenAI({\n  baseURL: 'http://localhost:3000/v1',\n  apiKey: process.env.MODEL_BRIDGE_API_KEY,\n});\n\nconst response = await client.chat.completions.create({\n  model: 'gpt-5.5',\n  messages: [{ role: 'user', content: '你好！' }],\n});\nconsole.log(response.choices[0].message.content);`,
    claude: `export ANTHROPIC_BASE_URL=http://localhost:3000\nexport ANTHROPIC_AUTH_TOKEN=mb-your-api-key\n\nclaude`,
    codex: `[profiles.model-bridge]\nmodel_provider = "model-bridge"\nmodel = "gpt-5.5"\n\n[model_providers.model-bridge]\nname = "model-bridge"\nbase_url = "http://localhost:3000/v1"\nenv_key = "MODEL_BRIDGE_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false`,
    gemini: `curl http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent \\\n  -H "x-goog-api-key: $MODEL_BRIDGE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"contents":[{"parts":[{"text":"你好！"}]}]}'`,
    images: `curl http://localhost:3000/v1/images/generations \\\n  -H "Authorization: Bearer $MODEL_BRIDGE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "gpt-image-2",\n    "prompt": "一只坐在窗边的橘猫",\n    "size": "1024x1024"\n  }'`,
  };
  function codeBlock(code, title = "Terminal") {
    return `<div class="code-block"><div class="code-header"><span>${esc(title)}</span>${iconButton("copy", "copy", "复制代码", `data-copy="${esc(code)}"`)}</div><pre><code>${esc(code)}</code></pre></div>`;
  }
  function docsPage() {
    const tabs = [
      ["quickstart", "快速开始"],
      ["claude", "Claude Code"],
      ["codex", "Codex CLI"],
      ["python", "Python SDK"],
      ["node", "Node.js SDK"],
      ["gemini", "Gemini API"],
      ["faq", "常见问题"],
    ];
    let article = "";
    if (docTab === "quickstart")
      article = `<span class="eyebrow">GETTING STARTED</span><h1>从第一个请求开始</h1><p class="lead">一个 API 地址，即可连接你所需要的模型。沿用熟悉的工具，把接入过程留给 Model Bridge。</p><div class="steps"><div class="step"><div><h3>连接上游账户</h3><p>在上游账户中添加服务商账户，并确认状态正常。</p><a class="link-button" href="accounts.html">前往账户管理 ${I("arrow", "icon-sm")}</a></div></div><div class="step"><div><h3>创建应用密钥</h3><p>给密钥命名，选择账户分组，设置合适的用量上限。</p><a class="link-button" href="${href("keys")}">创建 API 密钥 ${I("arrow", "icon-sm")}</a></div></div><div class="step"><div><h3>发送第一个请求</h3><p>设置 MODEL_BRIDGE_API_KEY 环境变量，然后运行下方示例。</p></div></div></div><h2>试着说一声「你好」</h2>${codeBlock(snippets.curl)}<div class="inline-note">${I("info")}实际部署时，请将 localhost 地址替换为你的服务域名。演示密钥不能用于真实请求。</div>`;
    else if (docTab === "faq")
      article = `<span class="eyebrow">TROUBLESHOOTING</span><h1>常见问题</h1><p class="lead">从响应状态开始定位问题。</p>${[
        [
          "收到 401 Unauthorized",
          "检查 Authorization 头是否携带有效密钥，以及密钥是否已停用或过期。",
        ],
        [
          "收到 429 Too Many Requests",
          "检查密钥的速率、并发和额度限制，稍后重试。",
        ],
        [
          "没有可用的上游账户",
          "确认服务商已连接，且账户分组中存在正常账户。配额耗尽或冷却中的账户暂不参与调度。",
        ],
        [
          "模型未出现在列表中",
          "GET /v1/models 会根据密钥的服务商和模型访问限制过滤。检查密钥配置和模型映射。",
        ],
        [
          "图片接口不可用",
          "确认接入的 OpenAI 账户具备图片能力，并检查图片生成入口是否开启。",
        ],
      ]
        .map(
          ([q, a]) =>
            `<details class="faq-item"><summary>${q}${I("down", "icon-sm")}</summary><p>${a}</p></details>`,
        )
        .join("")}`;
    else {
      const titles = {
        claude: "连接 Claude Code",
        codex: "连接 Codex CLI",
        python: "使用 Python SDK",
        node: "使用 Node.js SDK",
        gemini: "连接 Gemini API",
      };
      article = `<span class="eyebrow">CLIENT INTEGRATION</span><h1>${titles[docTab]}</h1><p class="lead">保留你熟悉的工作方式，只需更新 API 地址和密钥。</p><h2>${docTab === "codex" ? "配置模型提供商" : "配置客户端"}</h2><p>${docTab === "codex" ? "将以下配置合并到 ~/.codex/config.toml，再设置 MODEL_BRIDGE_API_KEY 环境变量。" : "将 API 密钥放在环境变量中，避免直接写入代码。"}</p>${codeBlock(snippets[docTab], { claude: "Shell", codex: "config.toml", python: "Python", node: "JavaScript", gemini: "cURL" }[docTab])}${docTab === "codex" ? codeBlock("export MODEL_BRIDGE_API_KEY=mb-your-api-key\ncodex --profile model-bridge", "Shell") : ""}<h2>确认连接</h2><p>完成配置后发送一条测试消息，然后在「用量统计」中检查请求是否正常记录。</p><div class="inline-note mt">${I("info")}以上示例来自本项目的接入约定。HTML 演示仅展示配置方式，不会发送网络请求。</div>`;
    }
    return (
      pageHead() +
      `<div class="docs-layout"><nav class="docs-nav" aria-label="文档目录"><small>开始使用</small>${tabs.map(([v, t]) => `<button class="${docTab === v ? "active" : ""}" data-action="doc-tab" data-value="${v}">${t}</button>`).join("")}<small>接口参考</small><a class="nav-item" href="${href("api-docs")}">${I("code", "icon-sm")}API 文档</a></nav><article class="doc-article">${article}<div class="doc-footer"><span class="muted">Model Bridge · Developer docs</span><a class="link-button" href="${href("api-docs")}">查看 API 参考 ${I("arrow", "icon-sm")}</a></div></article></div>`
    );
  }
  let apiTab = "chat",
    codeLanguage = "curl";
  function apiDocsPage() {
    const endpoints = {
      chat: [
        "Chat Completions",
        "/v1/chat/completions",
        "兼容 OpenAI Chat Completions 格式，支持多轮文本对话。",
      ],
      responses: [
        "Responses",
        "/v1/responses",
        "统一的 Responses API，适用于支持该格式的客户端。",
      ],
      messages: [
        "Messages",
        "/v1/messages",
        "兼容 Anthropic Messages 格式，接入 Claude 系列模型。",
      ],
      images: [
        "图片生成",
        "/v1/images/generations",
        "通过 OpenAI 账户桥接图片生成能力。",
      ],
      models: [
        "模型列表",
        "/v1/models",
        "列出当前 API 密钥可访问的模型与别名。",
      ],
    };
    const [title, path, desc] = endpoints[apiTab];
    let code =
      apiTab === "images"
        ? snippets.images
        : apiTab === "models"
          ? `curl http://localhost:3000/v1/models \\\n  -H "Authorization: Bearer $MODEL_BRIDGE_API_KEY"`
          : apiTab === "responses"
            ? `curl http://localhost:3000/v1/responses \\\n  -H "Authorization: Bearer $MODEL_BRIDGE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gpt-5.5","input":"你好！"}'`
            : apiTab === "messages"
              ? `curl http://localhost:3000/v1/messages \\\n  -H "x-api-key: $MODEL_BRIDGE_API_KEY" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,\n       "messages":[{"role":"user","content":"你好！"}]}'`
              : snippets[codeLanguage];
    return (
      pageHead() +
      `<div class="docs-layout"><nav class="docs-nav" aria-label="API 接口目录"><small>API REFERENCE</small>${Object.entries(
        endpoints,
      )
        .map(
          ([v, [t]]) =>
            `<button class="${apiTab === v ? "active" : ""}" data-action="api-tab" data-value="${v}">${t}</button>`,
        )
        .join(
          "",
        )}<small>开始使用</small><a class="nav-item" href="docs.html">${I("docs", "icon-sm")}接入指南</a></nav><article class="doc-article"><span class="eyebrow">API REFERENCE</span><h1>${title}</h1><p class="lead">${desc}</p><div class="api-endpoint"><span class="method">${apiTab === "models" ? "GET" : "POST"}</span><code>${path}</code><span class="muted" style="margin-left:auto;font-size:11px">Bearer Token</span></div><h2>请求示例</h2>${
        apiTab === "chat"
          ? `<div class="segmented" aria-label="示例代码语言">${[
              ["curl", "cURL"],
              ["python", "Python"],
              ["node", "Node.js"],
            ]
              .map(
                ([v, t]) =>
                  `<button data-action="code-language" data-value="${v}" class="${codeLanguage === v ? "active" : ""}">${t}</button>`,
              )
              .join("")}</div>`
          : ""
      }${codeBlock(code, apiTab === "chat" ? { curl: "cURL", python: "Python", node: "JavaScript" }[codeLanguage] : "cURL")}<h2>${apiTab === "models" ? "响应字段" : "请求参数"}</h2><div class="table-scroll"><table><thead><tr><th>字段</th><th>类型</th><th>说明</th></tr></thead><tbody>${(apiTab ===
      "models"
        ? [
            ["data", "array", "可访问的模型列表"],
            ["id", "string", "模型 ID 或配置的别名"],
          ]
        : apiTab === "images"
          ? [
              ["model", "string", "图片模型 ID，例如 gpt-image-2"],
              ["prompt", "string · 必填", "图片生成提示词"],
              ["size", "string", "图片尺寸，例如 1024x1024"],
            ]
          : apiTab === "responses"
            ? [
                ["model", "string · 必填", "目标模型 ID"],
                ["input", "string / array · 必填", "文本或结构化输入"],
                ["stream", "boolean", "是否使用流式输出"],
              ]
            : [
                ["model", "string · 必填", "目标模型 ID 或别名"],
                ["messages", "array · 必填", "按顺序传入对话消息"],
                ["stream", "boolean", "是否使用流式输出"],
                [
                  apiTab === "messages"
                    ? "max_tokens"
                    : "max_completion_tokens",
                  "integer",
                  apiTab === "messages"
                    ? "必填，最大输出 Token 数"
                    : "最大输出 Token 数",
                ],
              ]
      )
        .map(
          (r) =>
            `<tr><td><code>${r[0]}</code></td><td>${r[1]}</td><td style="white-space:normal">${r[2]}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div>${apiTab === "chat" ? `<div class="api-playground"><h2>请求演示</h2><p>编辑消息，查看响应结构示例。本地模拟，不消耗模型额度。</p><form data-form="api-demo"><label class="field mt"><span>请求内容</span><textarea name="request" spellcheck="false" required>{"model":"gpt-5.5","messages":[{"role":"user","content":"你好，Model Bridge！"}]}</textarea></label><div class="form-error" role="alert"></div><button class="btn btn-primary" type="submit">${I("code")}运行演示</button></form><div id="api-response"></div></div>` : ""}<div class="inline-note mt">${I("shield")}真实 API Key 请在服务端保存。此界面不保存鉴权信息，也不会调用真实模型。</div></article></div>`
    );
  }
  function landingPage() {
    return `<div class="landing"><header class="public-header">${brand(true)}<nav class="public-nav" aria-label="首页导航"><a href="#features">产品能力</a><a href="models.html">模型广场</a><a href="docs.html">开发文档</a><a class="btn btn-primary" href="login.html">登录工作空间 ${I('arrow','icon-sm')}</a></nav></header><main id="main">
      <section class="landing-hero hero-centered"><span class="launch-label"><span class="dot"></span>为你的 AI 工作流而生 ${I('arrow','icon-sm')}</span><h1>所有模型。<br><em>一个连接。</em></h1><p class="lead">把 Claude、OpenAI、Gemini 和更多模型，<br class="desktop-break">连接到统一的 API。你的工具，你的模型，你的工作空间。</p><div class="hero-actions"><a class="btn btn-primary" href="user-overview.html">开始探索 ${I('arrow')}</a><a class="btn" href="docs.html">查看开发文档 ${I('code')}</a></div><div class="hero-capabilities"><span>${I('check','icon-sm')}自托管</span><span>${I('check','icon-sm')}标准 API</span><span>${I('check','icon-sm')}灵活的账户调度</span></div></section>
      <section class="landing-workbench" aria-label="模型接入方式"><div class="workbench-intro"><span class="eyebrow">ONE BRIDGE, EVERY MODEL</span><h2>熟悉的工具，<br>更多的选择。</h2><p>沿用现有 SDK，仅需更换 API 地址与密钥。</p><div class="workbench-providers">${['claude','openai','gemini','deepseek'].map(p=>`<a href="models.html">${providerAvatar(p)}<span>${providers[p].name}</span>${I('chevron','icon-sm')}</a>`).join('')}</div></div><div class="code-block landing-code"><div class="code-header"><span>${I('code','icon-sm')} quickstart.ts</span>${iconButton('copy','copy','复制接入示例',`data-copy="${esc(snippets.node)}"`)}</div><pre><code><span class="code-comment">// 一个端点。所有可能。</span>\nimport OpenAI from 'openai';\n\nconst bridge = new OpenAI({\n  baseURL: 'http://localhost:3000/v1',\n  apiKey: process.env.MODEL_BRIDGE_API_KEY\n});\n\nconst response = await bridge.chat\n  .completions.create({\n    model: 'gpt-5.5',\n    messages: [{\n      role: 'user',\n      content: 'Let’s build something.'\n    }]\n  });</code></pre><div class="code-status">${I('check','icon-sm')}兼容 OpenAI SDK <span>READY TO CONNECT</span></div></div></section>
      <section id="features" class="landing-section"><div class="landing-section-head"><div><span class="eyebrow">BUILT FOR YOUR WORKFLOW</span><h2>从连接，到掌控。</h2></div><p>把复杂的模型管理，留在一个清晰的工作空间里。</p></div><div class="feature-grid">${[['01','code','统一接口','兼容 OpenAI、Anthropic 与 Gemini，连接你熟悉的开发工具。'],['02','account-groups','灵活调度','通过分组、优先级与多账户轮换，为不同任务分配合适资源。'],['03','stats','透明用量','从请求到 Token，从密钥到用户，清楚了解每一笔模型消耗。']].map(([n,i,t,p])=>`<article class="feature"><div class="feature-heading">${I(i)}<span>${n}</span></div><h3>${t}</h3><p>${p}</p></article>`).join('')}</div><div class="landing-cta"><div><h2>开始你的下一个项目。</h2><p>打开演示工作空间，体验完整的模型管理流程。</p></div><a class="btn btn-primary" href="index.html">进入工作空间 ${I('arrow')}</a></div></section></main><footer class="public-footer"><span>© 2026 Model Bridge</span><span>All models. One bridge.</span><a href="docs.html">开发文档 ${I('external','icon-sm')}</a></footer></div>`;
  }
  const authAside = () =>
    `<aside class="auth-aside"><span class="auth-aside-label">MODEL BRIDGE / WORKSPACE</span><div class="auth-statement"><span class="eyebrow">ALL MODELS. ONE BRIDGE.</span><h2>把想法，<br>连接到<span>可能。</span></h2><p>你的模型、工具与工作流。<br>在一个工作空间里，从容连接。</p><div class="auth-provider-stack">${['claude','openai','gemini','deepseek'].map(providerAvatar).join('')}<span>与你熟悉的模型，一起工作</span></div><div class="auth-proof"><div><strong>8<span>+</span></strong><small>模型服务商</small></div><div><strong>36</strong><small>目录模型</small></div><div><strong>01</strong><small>统一接入端点</small></div></div></div><div class="auth-aside-footer">Your models. Your workspace. Your next idea.</div></aside>`;
  let authMode = "login";
  function loginPage() {
    const register = authMode === "register";
    return `<div class="auth-page">${authAside()}<main class="auth-main" id="main"><div class="auth-top"><span>${register ? "已有账户？" : "初次来到这里？"}</span><button class="link-button" data-action="auth-mode">${register ? "登录账户" : "创建账户"} ${I("arrow", "icon-sm")}</button></div><div class="auth-form-wrap">${brand(true)}<span class="eyebrow">WELCOME BACK</span><h1>${register ? "创建你的工作空间" : "欢迎回来"}</h1><p class="lead">${register ? "从一个账户开始，连接你的模型世界。" : "登录后，继续你的创造之旅。"}</p>${!register ? `<div class="segmented" aria-label="登录身份"><button data-action="auth-role" data-value="user" class="${authRole === "user" ? "active" : ""}" aria-pressed="${authRole === "user"}">用户登录</button><button data-action="auth-role" data-value="admin" class="${authRole === "admin" ? "active" : ""}" aria-pressed="${authRole === "admin"}">管理员登录</button></div>` : ""}<form data-form="auth">${register ? field("name", "姓名", "", "text", "", 'required maxlength="40" autocomplete="name"') : ""}${field("email", authRole === "admin" && !register ? "管理员账号" : "邮箱", authRole === "admin" && !register ? "admin" : "", authRole === "admin" && !register ? "text" : "email", "", 'required autocomplete="username" placeholder="' + (authRole === "admin" && !register ? "admin" : "you@example.com") + '"')}${field("password", "密码", "", "password", "", 'required minlength="' + (register ? "8" : "1") + '" autocomplete="' + (register ? "new-password" : "current-password") + '" placeholder="' + (register ? "至少 8 位字符" : "输入演示密码") + '"')}<div class="between"><label class="auth-agreement"><input type="checkbox" name="remember">${register ? "我已了解这是本地界面演示" : "记住演示登录身份"}</label>${!register ? '<button class="link-button" type="button" data-action="forgot-password">忘记密码？</button>' : ""}</div><div class="form-error" role="alert"></div><button class="btn btn-primary auth-submit" type="submit">${register ? "创建演示账户" : "登录演示控制台"} ${I("arrow")}</button></form><p class="auth-demo">本地交互演示，任意演示账号与密码均可体验。<br>不会登录真实系统，也不会保存你输入的密码。</p></div><div class="auth-bottom"><a href="landing.html">返回首页</a> · <a href="docs.html">使用文档</a></div></main></div>`;
  }
  function invitePage() {
    return `<div class="auth-page">${authAside()}<main class="auth-main" id="main"><div class="auth-top"><a class="link-button" href="login.html">已有账户？前往登录 ${I("arrow", "icon-sm")}</a></div><div class="auth-form-wrap">${brand(true)}<span class="invite-badge">${I("mail")}</span><h1>你的邀请已准备就绪</h1><p class="lead">管理员邀请你加入 Model Bridge。完成以下信息，即可体验个人工作空间。</p><div class="inline-note mb">${I("info")}这是本地邀请演示，不会创建真实账户。</div><form data-form="accept-invite">${field("name", "你的姓名", "", "text", "", 'required maxlength="40" autocomplete="name"')}${field("email", "邮箱", "", "email", "", 'required autocomplete="email" placeholder="you@example.com"')}${field("password", "设置密码", "", "password", "", 'required minlength="8" autocomplete="new-password"')}${field("confirmPassword", "确认密码", "", "password", "", 'required minlength="8" autocomplete="new-password"')}<div class="form-error" role="alert"></div><button class="btn btn-primary auth-submit" type="submit">接受邀请 ${I("arrow")}</button></form></div><div class="auth-bottom">Model Bridge · 本地界面演示</div></main></div>`;
  }
  function normalizeLinks() {
    document.querySelectorAll("a[href]").forEach((a) => {
      const raw = a.getAttribute("href");
      if (/^[a-z-]+\.html$/.test(raw)) {
        a.setAttribute(
          "href",
          file(raw === "index.html" ? "overview" : raw.replace(".html", "")),
        );
      }
    });
  }
  function navigate(route) {
    closeModal();
    closeMenu();
    const next = route === "index" ? "overview" : route;
    if (location.hash === "#" + next) {
      page = next;
      isUser = page.startsWith("user-");
      render();
    } else location.hash = next;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  let lastFocus = null,
    menuAnchor = null;
  function showModal(title, body, description = "", width = 490) {
    closeMenu();
    const modal = document.getElementById("modal");
    if (!modal.open) lastFocus = document.activeElement;
    modal.style.width = width + "px";
    modal.innerHTML = `<div class="modal-header"><div><h2 id="modal-title">${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ""}</div>${iconButton("close", "close-modal", "关闭弹窗")}</div><div class="modal-body">${body}</div>`;
    document.body.classList.add("modal-open");
    if (!modal.open) modal.showModal();
    normalizeLinks();
    const input = modal.querySelector(
      "input:not([type=hidden]),select,textarea",
    );
    if (input) input.focus();
  }
  function closeModal() {
    const modal = document.getElementById("modal");
    if (modal?.open) {
      modal.close();
      document.body.classList.remove("modal-open");
      if (lastFocus?.isConnected) lastFocus.focus();
    }
  }
  function closeMenu() {
    document.getElementById("menu-popover")?.remove();
    if (menuAnchor) {
      menuAnchor.setAttribute("aria-expanded", "false");
      menuAnchor = null;
    }
  }
  function showMenu(anchor, content) {
    const same = menuAnchor === anchor;
    closeMenu();
    if (same) return;
    menuAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    const menu = document.createElement("div");
    menu.id = "menu-popover";
    menu.className = "menu-popover";
    menu.setAttribute("role", "menu");
    menu.innerHTML = content;
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left =
      Math.max(
        12,
        Math.min(
          rect.right - menu.offsetWidth,
          innerWidth - menu.offsetWidth - 12,
        ),
      ) + "px";
    menu.style.top =
      Math.max(
        12,
        Math.min(rect.bottom + 7, innerHeight - menu.offsetHeight - 12),
      ) + "px";
    menu
      .querySelectorAll("a,button")
      .forEach((x) => x.setAttribute("role", "menuitem"));
    normalizeLinks();
    menu.querySelector("a,button")?.focus();
  }
  function menuItem(text, action, icon, attrs = "", danger = false) {
    return `<button type="button" data-action="${action}" ${attrs} ${danger ? 'class="danger-button"' : ""}>${I(icon)}${text}</button>`;
  }
  function rowMenuItems(type, id) {
    const r = state[type]?.find((x) => x.id === id);
    if (!r) return "";
    const attrs = `data-type="${type}" data-id="${esc(id)}"`;
    let items = "";
    if (["accounts", "keys", "groups", "plans"].includes(type))
      items += menuItem("编辑", "edit-record", "edit", attrs);
    if (type === "accounts")
      items += menuItem("演示健康检查", "check-account", "refresh", attrs);
    if (type === "keys")
      items += menuItem(
        "复制演示密钥",
        "copy",
        "copy",
        `data-copy="${esc(r.key)}"`,
      );
    if (type === "groups")
      items += menuItem("管理成员", "group-members", "users", attrs);
    if (type === "users")
      items +=
        menuItem("查看用户", "user-detail", "users", attrs) +
        menuItem("调整演示余额", "adjust-balance", "wallet", attrs);
    if (type === "payments") {
      items += menuItem("订单详情", "payment-detail", "payments", attrs);
      if (r.status === "待支付")
        items +=
          menuItem("模拟确认入账", "payment-settle", "check", attrs) +
          menuItem("取消演示订单", "payment-cancel", "close", attrs, true);
    }
    if (type === "codes")
      items += menuItem(
        "复制兑换码",
        "copy",
        "copy",
        `data-copy="${esc(r.code)}"`,
      );
    if (["accounts", "keys", "users"].includes(type))
      items += menuItem(
        r.status === "已停用" ? "启用" : "停用",
        "toggle-record",
        r.status === "已停用" ? "check" : "close",
        attrs,
        r.status !== "已停用",
      );
    if (type === "plans")
      items += menuItem(
        r.status === "已上架" ? "下架套餐" : "上架套餐",
        "toggle-record",
        "subscription-plans",
        attrs,
      );
    if (
      ["accounts", "keys", "groups", "codes", "plans"].includes(type) &&
      id !== "group-3"
    )
      items += menuItem("删除", "delete-record", "trash", attrs, true);
    return items;
  }
  function searchModal(query = "") {
    const routes = [
      ...adminNav.flatMap(([, items]) => items),
      ...userNav.flatMap(([, items]) => items),
      ["landing", "品牌首页", "overview"],
      ["login", "登录页面", "keys"],
    ];
    const matches = routes.filter(([, t]) =>
      t.toLowerCase().includes(query.trim().toLowerCase()),
    );
    const list =
      matches
        .map(
          ([route, title, icon]) =>
            `<a href="${file(route)}">${I(icon)}${title}<small>${route.startsWith("user-") ? "个人空间" : ["landing", "login"].includes(route) ? "公开页面" : "管理后台"}</small></a>`,
        )
        .join("") ||
      '<div class="empty-state"><h3>没有找到相关页面</h3><p>试试「密钥」「模型」或「钱包」。</p></div>';
    if (document.getElementById("command-input")) {
      document.getElementById("command-list").innerHTML = list;
      return;
    }
    showModal(
      "快速前往",
      `<label class="sr-only" for="command-input">搜索页面</label><input class="command-search" id="command-input" type="search" placeholder="搜索页面或功能…" autocomplete="off"><div class="command-list" id="command-list">${list}</div><div class="command-footer">↑ ↓ 选择页面 · Enter 打开 · Esc 关闭</div>`,
      "找到需要的功能，继续你的工作",
      540,
    );
    document.getElementById("command-input").focus();
  }
  function accountForm(id) {
    const r = state.accounts.find((x) => x.id === id);
    showModal(
      r ? "编辑账户" : "连接上游账户",
      `<form data-form="account" data-id="${id || ""}"><div class="form-grid">${field("name", "账户名称", r?.name || "", "text", "", 'required maxlength="60" placeholder="例如：Claude · 主账户"')}${selectField(
        "provider",
        "模型服务商",
        Object.entries(providers).map(([id, p]) => [id, p.name]),
        r?.provider || "claude",
      )}${selectField("auth", "认证方式", ["OAuth", "API Key"], r?.auth || "OAuth")}${selectField("group", "账户分组", groupOptions(), r?.group || "默认账户池")}${field("priority", "调度优先级", r?.priority || 50, "number", "数值越高，调度越优先。", 'required min="1" max="100"')}${field("limit", "配额阈值（%）", r?.threshold || 90, "number", "", 'required min="1" max="100"')}</div><div class="inline-note mt">${I("info")}本地演示将模拟授权成功，无需输入真实 API Key 或 OAuth 凭据。</div><div class="form-error" role="alert"></div>${formActions(r ? "保存账户" : "连接演示账户")}</form>`,
      "统一管理账户、配额与调度方式",
      540,
    );
  }
  function keyForm(id) {
    const r = state.keys.find((x) => x.id === id);
    showModal(
      r ? "编辑密钥" : "创建 API 密钥",
      `<form data-form="key" data-id="${id || ""}"><div class="form-grid">${field("name", "密钥名称", r?.name || "", "text", "", 'required maxlength="60" placeholder="例如：My Production App"')}${selectField("owner", "归属用户", isUser ? ["Alex Chen"] : state.users.map((u) => u.name), r?.owner || "Alex Chen")}${selectField("group", "账户分组", groupOptions(), r?.group || "默认账户池")}${selectField("provider", "允许的服务商", ["全部服务商", ...Object.values(providers).map((p) => p.name)], r?.provider || "全部服务商")}${field("limit", "总额度上限（USD）", r?.limit ?? 100, "number", "填写 0 表示不限。", 'required min="0" step="0.01"')}${field("rate", "每分钟请求数", r?.rate ?? 60, "number", "", 'required min="1" max="10000"')}</div><details class="advanced-fields"><summary>更多访问控制 ${I("down", "icon-sm")}</summary><div class="form-grid mt">${field("concurrency", "最大并发", r?.concurrency ?? 5, "number", "", 'required min="1" max="1000"')}${field("expiry", "过期日期", r?.expiry || "", "date", "留空表示永久有效。")}<label class="field full"><span>模型映射</span><textarea name="mapping" placeholder="gpt-public=gpt-5.5">${esc(r?.mapping || "")}</textarea><small>每行一条映射：客户端模型名=上游模型名。</small></label></div></details><div class="form-error" role="alert"></div>${formActions(r ? "保存密钥" : "创建密钥", "仅生成演示密钥")}</form>`,
      "为每个应用提供独立、可控的访问凭证",
      540,
    );
  }
  function groupForm(id) {
    const r = state.groups.find((x) => x.id === id);
    showModal(
      r ? "编辑账户分组" : "创建账户分组",
      `<form data-form="group" data-id="${id || ""}">${field("name", "分组名称", r?.name || "", "text", "", 'required maxlength="40" ' + (id === "group-3" ? "readonly" : ""))}<label class="field mt"><span>分组说明</span><textarea name="description" maxlength="180" placeholder="这个账户池主要用于什么场景？">${esc(r?.description || "")}</textarea></label><div class="mt">${field("rate", "计费倍率", r?.rate ?? 1, "number", "1 为标准倍率，0.8 表示按 80% 计费。", 'required min="0.01" max="100" step="0.01"')}</div><div class="form-error" role="alert"></div>${formActions()}</form>`,
      "按场景组织模型资源",
    );
  }
  function groupMembers(id) {
    const g = state.groups.find((x) => x.id === id);
    showModal(
      "管理分组成员",
      `<form data-form="members" data-id="${id}"><div class="member-list">${state.accounts.map((a) => `<label class="member-option"><input type="checkbox" name="member" value="${a.id}" ${a.group === g.name ? "checked" : ""}>${providerAvatar(a.provider)}<span style="flex:1"><strong>${esc(a.name)}</strong><small>${esc(a.group)}</small></span>${badge(a.status, statusTone(a.status))}</label>`).join("")}</div><div class="inline-note">${I("info")}勾选的账户移入此分组，取消勾选的原成员回到默认账户池。</div>${formActions("保存成员")}</form>`,
      g.name,
      550,
    );
  }
  function planForm(id) {
    const p = state.plans.find((x) => x.id === id);
    showModal(
      p ? "编辑订阅套餐" : "创建订阅套餐",
      `<form data-form="plan" data-id="${id || ""}"><div class="form-grid">${field("name", "套餐名称", p?.name || "", "text", "", 'required maxlength="50"')}${selectField("group", "绑定账户池", groupOptions(), p?.group || "生产环境")}${field("price", "售价（USD）", p?.price ?? 29, "number", "", 'required min="0" step="0.01"')}${field("days", "有效期（天）", p?.days ?? 30, "number", "", 'required min="1" max="365"')}${field("daily", "每日额度（USD）", p?.daily ?? 8, "number", "", 'required min="0.01" step="0.01"')}${field("weekly", "每周额度（USD）", p?.weekly ?? 40, "number", "", 'required min="0.01" step="0.01"')}${field("monthly", "每月额度（USD）", p?.monthly ?? 120, "number", "", 'required min="0.01" step="0.01"')}${selectField("status", "上架状态", ["已上架", "已下架"], p?.status || "已上架")}<label class="field full"><span>套餐说明</span><textarea name="description" maxlength="160" required>${esc(p?.description || "")}</textarea></label></div><div class="form-error" role="alert"></div>${formActions(p ? "保存套餐" : "创建套餐")}</form>`,
      "灵活设置额度和销售方式",
      540,
    );
  }
  function codeForm() {
    showModal(
      "生成兑换码",
      `<form data-form="codes"><div class="form-grid">${field("quantity", "生成数量", 5, "number", "", 'required min="1" max="100"')}${field("value", "单张面额（USD）", 20, "number", "", 'required min="0.01" max="10000" step="0.01"')}${field("days", "有效天数", 30, "number", "从演示日期 2026-09-08 起计算。", 'required min="1" max="365"')}${field("note", "批次备注", "", "text", "", 'maxlength="60" placeholder="例如：新用户体验"')}</div><div class="inline-note">${I("info")}生成的兑换码可在用户中心体验兑换流程，仅影响本地演示余额。</div>${formActions("生成兑换码")}</form>`,
      "为用户提供可兑换的使用额度",
      520,
    );
  }
  function inviteForm() {
    showModal(
      "邀请用户加入",
      `<form data-form="invite"><div class="stack">${field("name", "用户姓名", "", "text", "", 'required maxlength="40"')}${field("email", "邮箱", "", "email", "", 'required maxlength="100" placeholder="name@example.com"')}${selectField("plan", "初始订阅", ["无订阅", ...state.plans.map((p) => p.name)], "无订阅")}</div><div class="inline-note">${I("mail")}将生成本地演示邀请链接，不会发送邮件。</div><div class="form-error" role="alert"></div>${formActions("创建演示邀请")}</form>`,
      "邀请用户创建个人模型工作空间",
    );
  }
  function requestDetail(id) {
    const r = activity.find((x) => x.id === id);
    if (!r) return;
    showModal(
      "请求详情",
      `<div class="between mb"><div class="flex">${providerAvatar(r.provider)}<strong class="mono">${r.model}</strong>${badge(r.status, statusTone(r.status))}</div></div><div class="detail-list">${[
        ["请求 ID", r.id],
        ["请求时间", "2026-" + r.time],
        ["API 密钥", r.key],
        ["服务商", providers[r.provider].name],
        ["输入 Tokens", num(Math.round(r.tokens * 0.72))],
        ["输出 Tokens", num(r.tokens - Math.round(r.tokens * 0.72))],
        ["响应耗时", r.latency + " ms"],
        ["请求费用", usd(r.cost, 4)],
      ]
        .map(
          ([k, v]) =>
            `<div class="detail-item"><small>${k}</small><strong>${esc(v)}</strong></div>`,
        )
        .join(
          "",
        )}</div><div class="divider"></div><h3>请求输入</h3>${codeBlock(JSON.stringify({ model: r.model, messages: [{ role: "user", content: "请帮我梳理这个项目的结构。" }] }, null, 2), "application/json")}${r.status === "失败" ? '<div class="inline-note">上游返回 429：演示账户已达到临时速率限制。</div>' : '<div class="inline-note">200 OK · 请求处理成功。内容为本地演示样例。</div>'}`,
      r.id,
      560,
    );
  }
  function modelDetail(id) {
    const m = window.BRIDGE_CATALOG.models.find((x) => x.id === id);
    if (!m) return;
    showModal(
      m.name,
      `<div class="flex mb">${providerAvatar(m.provider)}<span class="mono">${esc(m.id)}</span>${iconButton("copy", "copy", "复制模型 ID", `data-copy="${esc(m.id)}"`)}</div><p>${esc(m.description)}</p><div class="model-tags mt">${m.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div><div class="detail-list">${[
        ["上下文窗口", m.context],
        ["模型服务商", providers[m.provider].name],
        ["输入价格 / 1M tokens", usd(m.inputPrice)],
        ["输出价格 / 1M tokens", usd(m.outputPrice)],
      ]
        .map(
          ([k, v]) =>
            `<div class="detail-item"><small>${k}</small><strong>${esc(v)}</strong></div>`,
        )
        .join(
          "",
        )}</div><div class="inline-note mt">${I("info")}参数与价格来自仓库中的静态模型目录，仅作为界面演示。</div><div class="form-actions"><button class="btn" data-action="close-modal">关闭</button><a class="btn btn-primary" href="${href("api-docs")}">查看调用示例 ${I("arrow")}</a></div>`,
      "模型能力与接入信息",
      540,
    );
  }
  function balanceForm(id) {
    const u = state.users.find((x) => x.id === id);
    showModal(
      "调整钱包余额",
      `<form data-form="balance" data-id="${id}"><div class="flex mb">${avatar(u.name)}<div><h3>${esc(u.name)}</h3><small class="muted">当前余额 ${usd(u.balance)}</small></div></div>${field("amount", "调整金额（USD）", "", "number", "正数增加，负数扣减。", 'required step="0.01" min="-' + u.balance + '" max="100000"')}<div class="mt">${field("note", "调整原因", "", "text", "", 'required maxlength="100" placeholder="例如：补发体验额度"')}</div><div class="form-error" role="alert"></div>${formActions("确认调整", "本地演示")}</form>`,
      "变更仅影响当前浏览器的模拟余额",
    );
  }
  function rechargeForm() {
    showModal(
      "充值钱包",
      `<form data-form="recharge"><p class="muted" style="font-size:11px;margin-bottom:15px">当前余额 <strong class="positive">${usd(state.wallet)}</strong></p><div class="amount-options">${[10, 50, 100, 200].map((n) => `<button class="btn ${n === 50 ? "selected" : ""}" type="button" data-action="recharge-amount" data-value="${n}">$${n}</button>`).join("")}</div>${field("amount", "充值金额（USD）", 50, "number", "", 'required min="1" max="10000" step="0.01"')}<div class="mt">${selectField("channel", "支付方式", ["支付宝"], "支付宝")}</div><div class="inline-note">${I("info")}点击后模拟充值成功，不会打开支付渠道或产生真实扣费。</div><div class="form-error" role="alert"></div>${formActions("模拟充值")}</form>`,
      "为下一个想法，补充一点能量",
    );
  }
  function redeemForm() {
    showModal(
      "兑换额度",
      `<form data-form="redeem">${field("code", "兑换码", "", "text", "", 'required autocomplete="off" placeholder="输入你的演示兑换码"')}<div class="inline-note">可用体验码：<button class="link-button mono" type="button" data-action="fill-redeem">DEMO-WELCOME-8X2M</button><br>也可以在管理后台生成新的演示兑换码。</div><div class="form-error" role="alert"></div>${formActions("确认兑换")}</form>`,
      "兑换成功后，额度将加入演示钱包",
    );
  }
  function planStore() {
    showModal(
      "选择你的订阅",
      `<div class="resource-grid">${planCards(true)}</div><div class="inline-note mt">使用演示钱包余额模拟购买，额度和订阅信息仅在本地更新。</div>`,
      "找到适合你的模型使用计划",
      990,
    );
  }
  function confirmAction(title, message, action, attrs = "", label = "确认") {
    showModal(
      title,
      `<div class="confirmation-icon">${I(action === "confirm-delete" ? "trash" : "info")}</div><p>${message}</p><div class="form-actions"><button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="${action}" ${attrs}>${label}</button></div>`,
      "此操作仅影响本地演示数据",
    );
  }
  function refreshAfterSave(message) {
    save();
    closeModal();
    render();
    toast(message);
  }
  function addWalletEntry(type, amount, note) {
    state.wallet = Number((state.wallet + amount).toFixed(4));
    state.users.find((u) => u.id === "usr-1").balance = state.wallet;
    state.walletEntries.unshift({
      time: "09-08 14:33",
      type,
      amount,
      balance: state.wallet,
      note,
    });
  }
  const newId = (prefix) =>
    prefix +
    "-" +
    (window.crypto?.randomUUID?.() ||
      Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  function csvExport(rows, name) {
    if (!rows.length) {
      toast("当前没有可以导出的记录");
      return;
    }
    const columns = Object.keys(rows[0]);
    const cell = (v) => {
      let value = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
      if (/^[=+\-@\t\r]/.test(value)) value = "'" + value;
      return '"' + value.replace(/"/g, '""') + '"';
    };
    const csv =
      "\uFEFF" +
      [
        columns.map(cell).join(","),
        ...rows.map((r) => columns.map((k) => cell(r[k])).join(",")),
      ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `ModelBridge-${name}-demo.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("演示数据已导出");
  }
  function formError(form, message) {
    let el = form.querySelector(".form-error");
    if (!el) {
      el = document.createElement("div");
      el.className = "form-error";
      el.setAttribute("role", "alert");
      form.prepend(el);
    }
    el.textContent = message;
    el.scrollIntoView({ block: "nearest" });
  }
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    if (!form.reportValidity()) return;
    const kind = form.dataset.form;
    const id = form.dataset.id;
    const data = new FormData(form);
    const str = (n) => String(data.get(n) || "").trim();
    const val = (n) => Number(data.get(n));
    if (kind === "account") {
      const old = state.accounts.find((x) => x.id === id);
      const record = {
        id: id || newId("acc"),
        name: str("name"),
        provider: str("provider"),
        auth: str("auth"),
        group: str("group"),
        priority: val("priority"),
        threshold: val("limit"),
        used: old?.used ?? 0,
        status: old?.status || "正常",
        latency: old?.latency || 328,
      };
      if (old) Object.assign(old, record);
      else state.accounts.unshift(record);
      refreshAfterSave(old ? "账户已更新" : "演示账户已连接");
    }
    if (kind === "key") {
      const mapping = str("mapping");
      if (
        mapping &&
        mapping
          .split("\n")
          .some((l) => l.trim() && !/^[^=\s]+=[^=\s]+$/.test(l.trim()))
      ) {
        formError(
          form,
          "模型映射格式应为：客户端模型名=上游模型名，每行一条。",
        );
        return;
      }
      const old = state.keys.find((x) => x.id === id);
      const r = {
        id: id || newId("key"),
        name: str("name"),
        owner: str("owner"),
        group: str("group"),
        provider: str("provider"),
        limit: val("limit"),
        rate: val("rate"),
        concurrency: val("concurrency"),
        expiry: str("expiry"),
        mapping,
        key: old?.key || "mb-demo-" + newId("key").slice(4),
        used: old?.used ?? 0,
        requests: old?.requests ?? 0,
        status: old?.status || "启用",
      };
      if (old) Object.assign(old, r);
      else state.keys.unshift(r);
      state.users.forEach(
        (u) => (u.keys = state.keys.filter((k) => k.owner === u.name).length),
      );
      save();
      render();
      if (old) {
        closeModal();
        toast("密钥配置已保存");
      } else
        showModal(
          "密钥创建成功",
          `<div class="flex positive mb">${I("check")}你的应用密钥已准备就绪</div><p>这是演示密钥，可用于查看复制和配置流程。</p><div class="secret-display">${esc(r.key)}</div><div class="form-actions">${btn("复制密钥", "copy", "copy", true, `data-copy="${esc(r.key)}"`)}${btn("完成", "close-modal")}</div>`,
          r.name,
        );
    }
    if (kind === "group") {
      const old = state.groups.find((x) => x.id === id);
      if (state.groups.some((g) => g.name === str("name") && g.id !== id)) {
        formError(form, "这个分组名称已存在，请换一个名称。");
        return;
      }
      if (old) {
        const before = old.name;
        state.accounts
          .filter((a) => a.group === before)
          .forEach((a) => (a.group = str("name")));
        state.keys
          .filter((k) => k.group === before)
          .forEach((k) => (k.group = str("name")));
        state.plans
          .filter((p) => p.group === before)
          .forEach((p) => (p.group = str("name")));
        Object.assign(old, {
          name: str("name"),
          description: str("description"),
          rate: val("rate"),
        });
      } else
        state.groups.push({
          id: newId("group"),
          name: str("name"),
          description: str("description"),
          rate: val("rate"),
          count: 0,
          keys: 0,
          providers: [],
        });
      refreshAfterSave("分组已保存");
    }
    if (kind === "members") {
      const g = state.groups.find((x) => x.id === id);
      const ids = data.getAll("member");
      state.accounts.forEach((a) => {
        if (ids.includes(a.id)) a.group = g.name;
        else if (a.group === g.name) a.group = "默认账户池";
      });
      refreshAfterSave("分组成员已更新");
    }
    if (kind === "plan") {
      if (val("weekly") < val("daily") || val("monthly") < val("weekly")) {
        formError(form, "请让月额度不低于周额度，周额度不低于日额度。");
        return;
      }
      const old = state.plans.find((p) => p.id === id);
      const r = {
        id: id || newId("plan"),
        name: str("name"),
        group: str("group"),
        description: str("description"),
        price: val("price"),
        days: val("days"),
        daily: val("daily"),
        weekly: val("weekly"),
        monthly: val("monthly"),
        status: str("status"),
        tag: old?.tag || "CUSTOM",
      };
      if (old) Object.assign(old, r);
      else state.plans.push(r);
      refreshAfterSave("订阅套餐已保存");
    }
    if (kind === "codes") {
      const batch = "BATCH-" + Date.now().toString(36).toUpperCase();
      const expiry = new Date(Date.UTC(2026, 8, 8 + val("days")))
        .toISOString()
        .slice(0, 10);
      for (let i = 0; i < val("quantity"); i++)
        state.codes.unshift({
          id: newId("code"),
          code: "DEMO-" + newId("").slice(1, 13).toUpperCase(),
          value: val("value"),
          status: "未兑换",
          batch,
          expiry,
          note: str("note"),
          user: "—",
        });
      refreshAfterSave(`已生成 ${val("quantity")} 张演示兑换码`);
    }
    if (kind === "invite") {
      if (
        state.users.some(
          (u) => u.email.toLowerCase() === str("email").toLowerCase(),
        )
      ) {
        formError(form, "这个邮箱已经存在。");
        return;
      }
      const uid = newId("usr");
      state.users.unshift({
        id: uid,
        name: str("name"),
        email: str("email"),
        balance: 0,
        status: "待激活",
        keys: 0,
        requests: 0,
        cost: 0,
        plan: str("plan"),
        concurrency: 5,
      });
      save();
      render();
      showModal(
        "演示邀请已创建",
        `<div class="flex positive mb">${I("check")}邀请信息已准备就绪</div><p>${esc(str("name"))} · ${esc(str("email"))}</p><div class="inline-note mt">邀请邮件未发送。打开下方页面可体验接受邀请流程。</div><div class="form-actions">${btn("复制演示邀请地址", "copy", "copy", false, `data-copy="${esc(new URL("index.html#accept-invite", location.href).href)}"`)}<a class="btn btn-primary" href="${file("accept-invite")}">查看邀请 ${I("arrow")}</a></div>`,
        "本地邀请演示",
      );
    }
    if (kind === "balance") {
      const u = state.users.find((x) => x.id === id);
      const amount = val("amount");
      if (!amount) {
        formError(form, "请输入不为 0 的调整金额。");
        return;
      }
      if (u.balance + amount < 0) {
        formError(form, "扣减金额不能超过当前余额。");
        return;
      }
      if (u.id === "usr-1") addWalletEntry("账户充值", amount, str("note"));
      else u.balance = Number((u.balance + amount).toFixed(4));
      refreshAfterSave("演示钱包余额已更新");
    }
    if (kind === "recharge") {
      const amount = val("amount");
      addWalletEntry("账户充值", amount, "模拟支付宝充值");
      state.payments.unshift({
        id: "MBDEMO" + Date.now(),
        user: "Alex Chen",
        amount,
        status: "已入账",
        channel: "支付宝",
        time: "09-08 14:33",
        note: "本地模拟充值",
      });
      refreshAfterSave(`模拟充值成功，余额 ${usd(state.wallet)}`);
    }
    if (kind === "redeem") {
      const code = state.codes.find(
        (c) => c.code.toUpperCase() === str("code").toUpperCase(),
      );
      if (!code) {
        formError(form, "兑换码不存在，请检查后重试。");
        return;
      }
      if (code.status === "已兑换") {
        formError(form, "这个兑换码已经使用过了。");
        return;
      }
      if (code.expiry < "2026-09-08") {
        formError(form, "这个兑换码已过期。");
        return;
      }
      code.status = "已兑换";
      code.user = "Alex Chen";
      addWalletEntry("兑换码", code.value, code.note || "演示兑换");
      refreshAfterSave(`兑换成功，已到账 ${usd(code.value)}`);
    }
    if (kind === "settings") {
      if (settingsTab === "account") {
        if (str("newPassword") !== str("confirmPassword")) {
          formError(form, "两次输入的新密码不一致。");
          return;
        }
        form.reset();
        toast("已演示密码更新，输入的密码未保存。");
        return;
      }
      const s = state.settings;
      if (settingsTab === "general") {
        try {
          const u = new URL(str("baseUrl"));
          if (!["http:", "https:"].includes(u.protocol)) throw Error();
        } catch {
          formError(form, "请输入有效的 http 或 https API 地址。");
          return;
        }
        ["name", "timezone", "baseUrl", "email", "theme"].forEach(
          (k) => (s[k] = str(k)),
        );
      }
      if (settingsTab === "registration")
        ["registration", "inviteOnly"].forEach((k) => (s[k] = data.has(k)));
      if (settingsTab === "scheduling") {
        s.strategy = str("strategy");
        ["retry", "threshold", "cooldown"].forEach((k) => (s[k] = val(k)));
        s.quotaPause = data.has("quotaPause");
      }
      if (settingsTab === "security") {
        ["rateLimit", "writeLimit"].forEach((k) => (s[k] = val(k)));
        ["securityHeaders", "urlGuard"].forEach((k) => (s[k] = data.has(k)));
      }
      document.documentElement.dataset.theme = s.theme;
      save();
      render();
      toast("设置已保存到本地演示");
    }
    if (kind === "auth") {
      if (authMode === "register" && !str("name")) return;
      if (data.has("remember")) {
        try {
          localStorage.setItem("model-bridge-demo-role", authRole);
        } catch {}
      }
      navigate(
        authRole === "admin" && authMode !== "register"
          ? "overview"
          : "user-overview",
      );
      toast(
        authMode === "register" ? "已进入新用户体验流程" : "已进入演示控制台",
      );
    }
    if (kind === "accept-invite") {
      if (str("password") !== str("confirmPassword")) {
        formError(form, "两次输入的密码不一致。");
        return;
      }
      const invite = state.users.find(
        (u) => u.email.toLowerCase() === str("email").toLowerCase(),
      );
      if (invite?.status === "待激活") {
        invite.status = "正常";
        save();
      }
      navigate("user-overview");
      toast("邀请流程演示完成，已进入示例用户空间");
    }
    if (kind === "api-demo") {
      let request;
      try {
        request = JSON.parse(str("request"));
        if (
          !request ||
          typeof request.model !== "string" ||
          !request.model.trim() ||
          !Array.isArray(request.messages) ||
          !request.messages.length ||
          request.messages.some(
            (m) =>
              !m || typeof m.role !== "string" || typeof m.content !== "string",
          )
        )
          throw Error();
      } catch {
        formError(
          form,
          "请输入有效 JSON，包含 model 和非空 messages 数组；消息需要 role 与 content 字段。",
        );
        return;
      }
      form.querySelector(".form-error").textContent = "";
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      button.textContent = "生成演示响应…";
      setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.innerHTML = I("code") + "运行演示";
        const text = request.messages.at(-1).content;
        document.getElementById("api-response").innerHTML = codeBlock(
          JSON.stringify(
            {
              id: "chatcmpl-demo-" + Date.now(),
              object: "chat.completion",
              model: request.model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: `你好！已收到「${text.slice(0, 100)}」。这是 Model Bridge 的本地响应演示。`,
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 28,
                completion_tokens: 36,
                total_tokens: 64,
              },
            },
            null,
            2,
          ),
          "200 OK · 本地模拟响应",
        );
      }, 450);
    }
    if (kind === "import-accounts") {
      let list;
      try {
        list = JSON.parse(str("json"));
        if (
          !Array.isArray(list) ||
          !list.length ||
          list.length > 50 ||
          list.some(
            (r) =>
              !r ||
              typeof r.name !== "string" ||
              !r.name.trim() ||
              r.name.length > 60 ||
              !providers[r.provider],
          )
        )
          throw Error();
      } catch {
        formError(
          form,
          "请输入 1–50 个账户组成的 JSON 数组，每项需要名称 name 和有效服务商 provider。",
        );
        return;
      }
      list.forEach((r) =>
        state.accounts.push({
          id: newId("acc"),
          name: r.name,
          provider: r.provider,
          auth: "API Key",
          group: "默认账户池",
          used: 0,
          status: "正常",
          priority: 50,
          latency: 328,
        }),
      );
      refreshAfterSave(`已导入 ${list.length} 个演示账户`);
    }
  });
  let toastTimer;
  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 3500);
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制到剪贴板");
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.append(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      toast(ok ? "已复制到剪贴板" : "复制未成功，请手动选择内容复制。");
    }
  }
  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a[href]");
    if (anchor?.getAttribute("href") === "#features") {
      e.preventDefault();
      document
        .getElementById("features")
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (anchor?.getAttribute("href")?.startsWith("index.html#")) {
      e.preventDefault();
      navigate(anchor.getAttribute("href").split("#")[1]);
      return;
    }
    const b = e.target.closest("[data-action]");
    if (!b) {
      if (!e.target.closest("#menu-popover")) closeMenu();
      return;
    }
    const a = b.dataset.action,
      id = b.dataset.id,
      type = b.dataset.type,
      value = b.dataset.value;
    if (a === "copy") {
      void copy(b.dataset.copy || "");
      closeMenu();
    }
    if (a === "sidebar" || a === "close-sidebar") {
      const open = a === "sidebar";
      document.querySelector(".sidebar").classList.toggle("is-open", open);
      document
        .querySelector(".sidebar-overlay")
        .classList.toggle("is-open", open);
      document
        .querySelector("[data-action=sidebar]")
        .setAttribute("aria-expanded", String(open));
      if (open) document.querySelector(".sidebar .nav-item.active")?.focus();
      else document.querySelector("[data-action=sidebar]")?.focus();
    }
    if (a === "theme") {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      save();
      document.documentElement.dataset.theme = state.settings.theme;
      charts.forEach((c) => c.dispose());
      charts = [];
      drawCharts();
      toast(
        state.settings.theme === "dark"
          ? "已切换为深色主题"
          : "已切换为浅色主题",
      );
    }
    if (a === "period") {
      period = value;
      render();
    }
    if (a === "overview-tab") toast("当前正在查看运行概况");
    if (a === "workspace")
      showMenu(
        b,
        `<div class="menu-label">切换演示空间</div><a href="${file("overview")}">${I("overview")}管理工作空间 ${!isUser ? I("check") : ""}</a><a href="${file("user-overview")}">${I("users")}个人工作空间 ${isUser ? I("check") : ""}</a><a href="${file("landing")}">${I("external")}品牌首页</a>`,
      );
    if (a === "profile")
      showMenu(
        b,
        `<div class="menu-label">${isUser ? "Alex Chen · 个人账户" : "管理员 · 管理工作空间"}</div><a href="${file(isUser ? "user-overview" : "settings")}">${I("settings")}账户与设置</a><a href="${file(isUser ? "overview" : "user-overview")}">${I("users")}切换到${isUser ? "管理后台" : "用户中心"}</a><a href="${file("login")}">${I("logout")}退出演示</a>`,
      );
    if (a === "notifications")
      showModal(
        "通知",
        `<div class="notification-item"><span class="group-icon">${I("check")}</span><div><h3>服务连接状态正常</h3><p>4 家服务商已连接，资源池正在正常运行。</p><small>今天 14:32 · 演示通知</small></div></div><div class="notification-item"><span class="group-icon">${I("wallet")}</span><div><h3>钱包充值成功</h3><p>Alex Chen 的演示账户已充值 $100.00。</p><small>今天 09:32 · 演示通知</small></div></div>`,
        "你的工作空间动态",
      );
    if (a === "search") searchModal();
    if (a === "close-modal") closeModal();
    if (a === "paginate") {
      currentTable.page = Number(value);
      updateDataTable();
    }
    if (a === "clear-filters") {
      currentTable.query = "";
      currentTable.filters = {};
      currentTable.page = 1;
      render();
    }
    if (a === "export-table" || a === "export-page") {
      if (currentTable) csvExport(filteredData(), currentTable.type);
      else csvExport(activity, "activity");
    }
    if (a === "export-overview") csvExport(activity, "requests");
    if (a === "row-menu") showMenu(b, rowMenuItems(type, id));
    if (a === "request-detail") requestDetail(id);
    if (a === "create-account") accountForm();
    if (a === "create-key") keyForm();
    if (a === "create-group") groupForm();
    if (a === "create-plan") planForm();
    if (a === "edit-plan") planForm(id);
    if (a === "create-codes") codeForm();
    if (a === "invite-user") inviteForm();
    if (a === "group-members") groupMembers(id);
    if (a === "edit-record")
      ({
        accounts: accountForm,
        keys: keyForm,
        groups: groupForm,
        plans: planForm,
      })[type]?.(id);
    if (a === "toggle-record") {
      const r = state[type].find((x) => x.id === id);
      if (type === "plans")
        r.status = r.status === "已上架" ? "已下架" : "已上架";
      else
        r.status =
          r.status === "已停用"
            ? type === "keys"
              ? "启用"
              : "正常"
            : "已停用";
      refreshAfterSave("演示状态已更新");
    }
    if (a === "delete-record") {
      const r = state[type].find((x) => x.id === id);
      confirmAction(
        "删除这条记录？",
        `即将从本地演示中删除「${esc(r.name || r.code)}」。${type === "groups" ? "组内账户、密钥和套餐将转入默认账户池。" : ""}`,
        "confirm-delete",
        `data-type="${type}" data-id="${esc(id)}"`,
        "确认删除",
      );
    }
    if (a === "confirm-delete") {
      const r = state[type].find((x) => x.id === id);
      if (type === "groups") {
        ["accounts", "keys", "plans"].forEach((t) =>
          state[t]
            .filter((x) => x.group === r.name)
            .forEach((x) => (x.group = "默认账户池")),
        );
      }
      state[type] = state[type].filter((x) => x.id !== id);
      if (type === "keys")
        state.users.forEach(
          (u) => (u.keys = state.keys.filter((k) => k.owner === u.name).length),
        );
      refreshAfterSave("记录已从本地演示中删除");
    }
    if (a === "check-account" || a === "check-all") {
      closeMenu();
      toast("正在模拟检查账户连接…");
      setTimeout(() => {
        const list =
          a === "check-all"
            ? state.accounts
            : state.accounts.filter((x) => x.id === id);
        list
          .filter((x) => x.status !== "已停用")
          .forEach((x) => {
            x.status = x.used > 90 ? "冷却中" : "正常";
            x.latency =
              x.status === "正常" ? 286 + Math.floor(x.priority / 2) : 0;
          });
        save();
        if (page === "accounts") render();
        toast("演示检查完成：账户状态已更新");
      }, 650);
    }
    if (a === "import-accounts")
      showModal(
        "导入账户",
        `<form data-form="import-accounts"><label class="field"><span>账户 JSON</span><textarea name="json" class="mono" style="min-height:160px" required spellcheck="false">[\n  {"name":"My API Account","provider":"openai"}\n]</textarea><small>支持 claude、openai、gemini、deepseek、xiaomi、zhipu、qwen、kimi。</small></label><div class="inline-note">${I("info")}仅导入名称和服务商，不读取或保存任何真实凭据。</div><div class="form-error" role="alert"></div>${formActions("导入演示账户")}</form>`,
        "批量创建演示账户",
      );
    if (a === "user-detail") {
      const u = state.users.find((x) => x.id === id);
      showModal(
        "用户详情",
        `<div class="flex mb">${avatar(u.name)}<div><h2>${esc(u.name)}</h2><span class="muted" style="font-size:11px">${esc(u.email)}</span></div></div><div class="detail-list">${[
          ["余额", usd(u.balance)],
          ["订阅", u.plan],
          ["API 密钥", u.keys],
          ["累计请求", num(u.requests)],
          ["累计费用", usd(u.cost)],
          ["并发上限", u.concurrency],
          ["账户状态", u.status],
        ]
          .map(
            ([k, v]) =>
              `<div class="detail-item"><small>${k}</small><strong>${esc(v)}</strong></div>`,
          )
          .join(
            "",
          )}</div><div class="form-actions">${btn("调整余额", "adjust-balance", "wallet", true, `data-id="${id}"`)}</div>`,
        "演示用户资料",
      );
    }
    if (a === "adjust-balance") balanceForm(id);
    if (a === "payment-detail") {
      const p = state.payments.find((x) => x.id === id);
      showModal(
        "订单详情",
        `<div class="between mb"><strong class="mono">${esc(p.id)}</strong>${badge(p.status, statusTone(p.status))}</div><div class="detail-list">${[
          ["用户", p.user],
          ["金额", usd(p.amount)],
          ["支付方式", p.channel],
          ["创建时间", "2026-" + p.time],
          ["备注", p.note],
        ]
          .map(
            ([k, v]) =>
              `<div class="detail-item"><small>${k}</small><strong>${esc(v)}</strong></div>`,
          )
          .join(
            "",
          )}</div><div class="inline-note mt">这是本地模拟订单，不对应真实交易。</div>`,
        "充值订单记录",
      );
    }
    if (a === "payment-settle" || a === "payment-cancel")
      confirmAction(
        a === "payment-settle" ? "模拟确认入账" : "取消演示订单",
        a === "payment-settle"
          ? "确认后将增加该用户的演示钱包余额。"
          : "该演示订单会标记为已取消。",
        "confirm-payment",
        `data-id="${id}" data-value="${a === "payment-settle" ? "已入账" : "已取消"}"`,
      );
    if (a === "confirm-payment") {
      const p = state.payments.find((x) => x.id === id);
      if (p.status !== "待支付") {
        closeModal();
        toast("订单已处理，请勿重复操作");
        return;
      }
      p.status = value;
      if (value === "已入账") {
        const u = state.users.find((x) => x.name === p.user);
        if (u?.id === "usr-1")
          addWalletEntry("账户充值", p.amount, "模拟订单入账");
        else if (u) u.balance += p.amount;
      }
      refreshAfterSave("演示订单已更新");
    }
    if (a === "model-category") {
      modelCategory = value;
      document.querySelectorAll("[data-action=model-category]").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
      updateModels();
    }
    if (a === "clear-models") {
      modelCategory = "全部模型";
      modelProvider = "全部服务商";
      modelQuery = "";
      render();
    }
    if (a === "model-detail") modelDetail(id);
    if (a === "chart-mode") {
      metricMode = value;
      render();
    }
    if (a === "settings-tab") {
      settingsTab = value;
      render();
    }
    if (a === "reload-settings") render();
    if (a === "reset-demo")
      confirmAction(
        "恢复初始演示数据？",
        "新建的演示记录与本地设置将被初始示例替换。",
        "confirm-reset",
        "",
        "恢复初始数据",
      );
    if (a === "confirm-reset") {
      const theme = state.settings.theme;
      state = JSON.parse(JSON.stringify(initial));
      state.settings.theme = theme;
      currentTable = null;
      refreshAfterSave("初始演示数据已恢复");
    }
    if (a === "recharge") rechargeForm();
    if (a === "recharge-amount") {
      b.closest("form").elements.amount.value = value;
      b.closest(".amount-options")
        .querySelectorAll("button")
        .forEach((x) => x.classList.toggle("selected", x === b));
    }
    if (a === "redeem") redeemForm();
    if (a === "fill-redeem")
      b.closest("form").elements.code.value = "DEMO-WELCOME-8X2M";
    if (a === "plan-store") planStore();
    if (a === "buy-plan") {
      const p = state.plans.find((x) => x.id === id);
      if (state.wallet < p.price) {
        toast("演示余额不足，请先充值");
        return;
      }
      confirmAction(
        "订阅 " + p.name,
        `将从演示钱包扣除 ${usd(p.price)}，订阅有效期 ${p.days} 天。`,
        "confirm-buy",
        `data-id="${id}"`,
        "确认模拟购买",
      );
    }
    if (a === "confirm-buy") {
      const p = state.plans.find((x) => x.id === id);
      if (!p || p.status !== "已上架" || state.wallet < p.price) {
        toast("余额不足或套餐已下架");
        return;
      }
      addWalletEntry("订阅购买", -p.price, p.name);
      state.subscription = p.name;
      state.subscriptionUsed = 0;
      state.subscriptionDaysRemaining = p.days;
      state.users.find((u) => u.id === "usr-1").plan = p.name;
      refreshAfterSave("演示订阅已开通");
    }
    if (a === "wallet-history") {
      usageType = "wallet";
      navigate("user-usage");
    }
    if (a === "usage-tab") {
      usageType = value;
      currentTable = null;
      render();
    }
    if (a === "doc-tab") {
      docTab = value;
      render();
    }
    if (a === "api-tab") {
      apiTab = value;
      render();
    }
    if (a === "code-language") {
      codeLanguage = value;
      render();
    }
    if (a === "auth-role") {
      authRole = value;
      render();
    }
    if (a === "auth-mode") {
      authMode = authMode === "login" ? "register" : "login";
      render();
    }
    if (a === "forgot-password")
      showModal(
        "找回账户访问",
        `<p>真实部署中请联系站点管理员重置密码。</p><div class="inline-note mt">当前为本地演示，填写任意演示密码即可进入控制台。</div><div class="form-actions">${btn("返回登录", "close-modal", "arrow", true)}</div>`,
        "演示账户无需重置密码",
      );
  });
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.matches("[data-table-search]")) {
      currentTable.query = el.value;
      currentTable.page = 1;
      updateDataTable();
    }
    if (el.matches("[data-model-search]")) {
      modelQuery = el.value;
      updateModels();
    }
    if (el.id === "command-input") searchModal(el.value);
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-table-filter]")) {
      currentTable.filters[el.dataset.tableFilter] = el.value;
      currentTable.page = 1;
      updateDataTable();
    }
    if (el.matches("[data-model-provider]")) {
      modelProvider = el.value;
      updateModels();
    }
    if (el.matches("[data-stats-period]")) {
      period = el.value;
      render();
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchModal();
    }
    if (e.key === "Escape") {
      if (menuAnchor) {
        const anchor = menuAnchor;
        closeMenu();
        anchor.focus();
      }
      if (document.querySelector(".sidebar.is-open")) {
        document.querySelector("[data-action=close-sidebar]").click();
      }
    }
    const parent =
      document.getElementById("menu-popover") ||
      document.getElementById("command-list");
    if (parent && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
      const items = [...parent.querySelectorAll("button,a")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "Enter" && document.activeElement.id === "command-input") {
        e.preventDefault();
        items[0]?.click();
      } else if (e.key !== "Enter") {
        e.preventDefault();
        items[
          (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        ]?.focus();
      }
    }
  });
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      const r = e.currentTarget.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        closeModal();
    }
  });
  document.getElementById("modal").addEventListener("close", () => {
    document.body.classList.remove("modal-open");
    if (lastFocus?.isConnected) lastFocus.focus();
  });
  window.addEventListener("hashchange", () => {
    const next = location.hash.slice(1) || "overview";
    if (!pages[next] && !["landing", "login", "accept-invite"].includes(next)) {
      navigate("overview");
      return;
    }
    closeModal();
    page = next;
    isUser = page.startsWith("user-");
    currentTable = null;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector("main h1")?.setAttribute("tabindex", "-1");
    document.querySelector("main h1")?.focus({ preventScroll: true });
  });
  window.addEventListener(
    "scroll",
    () => {
      if (menuAnchor) closeMenu();
    },
    { passive: true },
  );
  window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
  render();
})();
