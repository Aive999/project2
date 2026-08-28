(function () {
  const isLoginPage = location.pathname.endsWith("/login.html");
  const loggedIn = localStorage.getItem("adminLogin") === "true";
  const pageName = location.pathname.split("/").pop() || "admin.html";
  const nativeSetItem = Storage.prototype.setItem;
  const adminStorageKeys = new Set([
    "adminAccountData",
    "adminDataDictionary",
    "adminJobConfig",
    "adminCurrencySettings",
    "adminOnlineUsers",
    "adminOperationLog",
    "adminOrgs",
    "adminRoles",
    "adminUsers"
  ]);

  if (!isLoginPage && !loggedIn) {
    window.location.href = "login.html";
    return;
  }

  function purgeLegacyDummyData() {
    let changed = false;
    const removeMatching = (key, predicate) => {
      try {
        const rows = JSON.parse(localStorage.getItem(key) || "[]");
        if (!Array.isArray(rows)) return;
        const clean = rows.filter((row) => !predicate(row));
        if (clean.length !== rows.length) {
          localStorage.setItem(key, JSON.stringify(clean));
          changed = true;
        }
      } catch {
        localStorage.removeItem(key);
        changed = true;
      }
    };

    removeMatching("adminLoginLog", (row) => ["L1", "L2", "L3"].includes(row.id));
    removeMatching("adminAccountData", (row) => {
      const dummyNames = ["Alice Chen", "Brian Lee", "Cara Patel"];
      return ["ACC1001", "ACC1002", "ACC1003"].includes(row.id) || dummyNames.includes(row.name);
    });
    removeMatching("adminDataDictionary", (row) => ["D1", "D2", "D3", "D4", "D5"].includes(row.id));
    removeMatching("adminJobConfig", (row) => /^J([1-9]|10)$/.test(row.id || ""));
    removeMatching("adminCurrencySettings", (row) => ["K1", "K2", "K3"].includes(row.id));
    removeMatching("adminOnlineUsers", (row) => /^OU[1-6]$/.test(row.id || ""));
    removeMatching("adminOperationLog", (row) => ["O1", "O2", "O3"].includes(row.id));
    removeMatching("adminOrgs", (row) => ["root", "sales", "ops"].includes(row.coding));
    removeMatching("adminRoles", (row) => ["sys_manager", "sys_user", "kong_dan"].includes(row.coding));
    removeMatching("adminUsers", (row) => ["U1", "U2"].includes(row.id) && ["erupted", "admin"].includes(row.username));

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("adminTable:")) {
        localStorage.removeItem(key);
        changed = true;
      }
    });

    if (changed && sessionStorage.getItem("adminDummyDataCleaned") !== "true") {
      sessionStorage.setItem("adminDummyDataCleaned", "true");
      location.reload();
    }
  }

  purgeLegacyDummyData();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function isAdminStorageKey(key) {
    return adminStorageKeys.has(key) || key.startsWith("adminTable:");
  }

  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function syncStorageValue(key, value) {
    if (!isAdminStorageKey(key)) return;
    adminApi("admin_storage_set", { key, value }).catch(() => {});
  }

  function bindServerStorage() {
    if (window.__adminServerStorageBound) return;
    window.__adminServerStorageBound = true;
    Storage.prototype.setItem = function (key, value) {
      nativeSetItem.call(this, key, value);
      if (this !== localStorage) return;
      if (!isAdminStorageKey(key)) return;
      try {
        syncStorageValue(key, JSON.parse(value));
      } catch {
        syncStorageValue(key, value);
      }
    };
  }

  async function syncAdminStorageFromServer() {
    try {
      const data = await adminApi("admin_storage_all");
      const storage = data.storage || {};
      let changed = false;
      Object.entries(storage).forEach(([key, value]) => {
        if (!isAdminStorageKey(key)) return;
        const next = JSON.stringify(value ?? []);
        if (localStorage.getItem(key) !== next) {
          nativeSetItem.call(localStorage, key, next);
          changed = true;
        }
      });
      if (changed && sessionStorage.getItem(`adminStorageReloaded:${pageName}`) !== "true") {
        sessionStorage.setItem(`adminStorageReloaded:${pageName}`, "true");
        location.reload();
        return;
      }
      pushLocalAdminStorageToServer();
    } catch {
      // The admin still works with localStorage before Hostinger MySQL is configured.
    }
  }

  function pushLocalAdminStorageToServer() {
    Object.keys(localStorage).forEach((key) => {
      if (!isAdminStorageKey(key)) return;
      try {
        syncStorageValue(key, JSON.parse(localStorage.getItem(key)));
      } catch {
        syncStorageValue(key, localStorage.getItem(key));
      }
    });
  }

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateOnly(value) {
    return String(value || "").trim().slice(0, 10);
  }

  function readUsers() {
    return readJSON("demoExchangeUsers", {});
  }

  function readAdminAccounts() {
    return readJSON("adminAccountData", []);
  }

  async function adminApi(action, payload = {}) {
    const response = await fetch("../api/index.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Server request failed.");
    }
    return data;
  }

  function showToast(message, type = "success") {
    let toast = $(".admin-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "admin-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `admin-toast ${type} show`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  const ADMIN_LANGUAGE_KEY = "adminLanguage";
  const zhText = {
    "System Management": "\u7cfb\u7edf\u7ba1\u7406",
    "Menu Management": "\u83dc\u5355\u7ba1\u7406",
    "Role Management": "\u89d2\u8272\u7ba1\u7406",
    "Organization Maintenance": "\u7ec4\u7ec7\u7ef4\u62a4",
    "Post Maintenance": "\u5c97\u4f4d\u7ef4\u62a4",
    "User Configuration": "\u7528\u6237\u914d\u7f6e",
    "Data Dictionary": "\u6570\u636e\u5b57\u5178",
    "Online Users": "\u5728\u7ebf\u7528\u6237",
    "Login Log": "\u767b\u5f55\u65e5\u5fd7",
    "Operation Log": "\u64cd\u4f5c\u65e5\u5fd7",
    "Currency Rate Management": "\u6c47\u7387\u7ba1\u7406",
    "System Monitoring": "\u7cfb\u7edf\u76d1\u63a7",
    "Server Monitor": "\u670d\u52a1\u5668\u76d1\u63a7",
    "Cache Monitor": "\u7f13\u5b58\u76d1\u63a7",
    "Job Manager": "\u4efb\u52a1\u7ba1\u7406",
    "Job Config": "\u4efb\u52a1\u914d\u7f6e",
    "Job Log": "\u4efb\u52a1\u65e5\u5fd7",
    "Send Email": "\u53d1\u9001\u90ae\u4ef6",
    "Generator Code": "\u4ee3\u7801\u751f\u6210",
    "Erupt Code": "Erupt \u4ee3\u7801",
    "Exchange": "\u5151\u6362\u7ba1\u7406",
    "Account Management": "\u8d26\u6237\u7ba1\u7406",
    "User Level": "\u7528\u6237\u7b49\u7ea7",
    "Withdrawal Records": "\u63d0\u73b0\u8bb0\u5f55",
    "Recharge Review": "\u5145\u503c\u5ba1\u6838",
    "Top-up Records": "\u5145\u503c\u8bb0\u5f55",
    "Feedback": "\u53cd\u9988",
    "User Invitation Records": "\u7528\u6237\u9080\u8bf7\u8bb0\u5f55",
    "New Withdrawal Records": "\u65b0\u63d0\u73b0\u8bb0\u5f55",
    "Product Management": "\u4ea7\u54c1\u7ba1\u7406",
    "Account Services": "\u8d26\u6237\u670d\u52a1",
    "Service Setup": "\u670d\u52a1\u8bbe\u7f6e",
    "Service Review": "\u670d\u52a1\u5ba1\u6838",
    "Asset Management": "\u8d44\u4ea7\u7ba1\u7406",
    "Timed Exchange": "\u5b9a\u65f6\u5151\u6362",
    "New Currency Points": "\u65b0\u589e\u8d27\u5e01\u79ef\u5206",
    "Currency Asset List": "\u8d27\u5e01\u8d44\u4ea7\u5217\u8868",
    "Order Asset List": "\u8ba2\u5355\u8d44\u4ea7\u5217\u8868",
    "Reserved Currency Assets": "\u9884\u7559\u8d27\u5e01\u8d44\u4ea7",
    "Order Management": "\u8ba2\u5355\u7ba1\u7406",
    "Currency Flow Records": "\u8d27\u5e01\u6d41\u6c34\u8bb0\u5f55",
    "Currency Exchange Records": "\u5151\u6362\u8bb0\u5f55",
    "Currency Order Records": "\u8d27\u5e01\u8ba2\u5355\u8bb0\u5f55",
    "Content Management": "\u5185\u5bb9\u7ba1\u7406",
    "Reserved Currency": "\u9884\u7559\u8d27\u5e01",
    "Copywriting Management": "\u6587\u6848\u7ba1\u7406",
    "Certification Management": "\u8ba4\u8bc1\u7ba1\u7406",
    "User Identification": "\u7528\u6237\u8eab\u4efd\u8ba4\u8bc1",
    "Advanced Real Name": "\u9ad8\u7ea7\u5b9e\u540d\u8ba4\u8bc1",
    "Search Menu": "\u641c\u7d22\u83dc\u5355",
    "Start voice broadcast": "\u5f00\u542f\u8bed\u97f3\u64ad\u62a5",
    "Primary certification audit (0)": "\u521d\u7ea7\u8ba4\u8bc1\u5ba1\u6838 (0)",
    "Advanced Certification Audit (0)": "\u9ad8\u7ea7\u8ba4\u8bc1\u5ba1\u6838 (0)",
    "Withdrawal Review (0)": "\u63d0\u73b0\u5ba1\u6838 (0)",
    "Currency orders (0)": "\u8d27\u5e01\u8ba2\u5355 (0)",
    "Recharge Review (0)": "\u5145\u503c\u5ba1\u6838 (0)",
    "Logout": "\u9000\u51fa\u767b\u5f55",
    "Settings": "\u8bbe\u7f6e",
    "Home": "\u9996\u9875",
    "Customer Balance Operations": "\u5ba2\u6237\u4f59\u989d\u64cd\u4f5c",
    "Customer account": "\u5ba2\u6237\u8d26\u6237",
    "Amount (USD)": "\u91d1\u989d (USD)",
    "Recharge": "\u5145\u503c",
    "Balance status": "\u4f59\u989d\u72b6\u6001",
    "Reduce": "\u6263\u51cf",
    "Freeze Balance": "\u51bb\u7ed3\u4f59\u989d",
    "Unfreeze Balance": "\u89e3\u51bb\u4f59\u989d",
    "Customer Currency Balances": "\u5ba2\u6237\u8d27\u5e01\u4f59\u989d",
    "Refresh Users": "\u5237\u65b0\u7528\u6237",
    "User Details": "\u7528\u6237\u8be6\u60c5",
    "Search users": "\u641c\u7d22\u7528\u6237",
    "Any status": "\u4efb\u610f\u72b6\u6001",
    "Account ID": "\u8d26\u6237 ID",
    "Username": "\u7528\u6237\u540d",
    "Customer": "\u5ba2\u6237",
    "Phone": "\u624b\u673a",
    "Source": "\u6765\u6e90",
    "Created": "\u521b\u5efa\u65f6\u95f4",
    "Total Assets (USD)": "\u603b\u8d44\u4ea7 (USD)",
    "USD Balance": "USD \u4f59\u989d",
    "Other Currency Balances": "\u5176\u4ed6\u8d27\u5e01\u4f59\u989d",
    "Balance Status": "\u4f59\u989d\u72b6\u6001",
    "Account Status": "\u8d26\u6237\u72b6\u6001",
    "Registration Time": "\u6ce8\u518c\u65f6\u95f4",
    "Operation": "\u64cd\u4f5c",
    "Freeze": "\u51bb\u7ed3",
    "Unfreeze": "\u89e3\u51bb",
    "Active": "\u6b63\u5e38",
    "Frozen": "\u5df2\u51bb\u7ed3",
    "Currency code": "\u8d27\u5e01\u4ee3\u7801",
    "Name": "\u540d\u79f0",
    "USD rate": "USD \u6c47\u7387",
    "USD Rate": "USD \u6c47\u7387",
    "Change %": "\u6da8\u8dcc\u5e45 %",
    "Display": "\u663e\u793a\u72b6\u6001",
    "Visible": "\u663e\u793a",
    "Hidden": "\u9690\u85cf",
    "Add Currency": "\u6dfb\u52a0\u8d27\u5e01",
    "Code": "\u4ee3\u7801",
    "Save": "\u4fdd\u5b58",
    "Delete": "\u5220\u9664",
    "View": "\u67e5\u770b",
    "Edit": "\u7f16\u8f91",
    "Reset": "\u91cd\u7f6e",
    "Query": "\u67e5\u8be2",
    "Table Control": "\u8868\u683c\u63a7\u5236",
    "No Data": "\u6682\u65e0\u6570\u636e",
    "No records": "\u6682\u65e0\u8bb0\u5f55",
    "Cumulative number of users": "\u7d2f\u8ba1\u7528\u6237\u6570",
    "Number of new users today": "\u4eca\u65e5\u65b0\u589e\u7528\u6237\u6570",
    "Accumulated top-up (USD)": "\u7d2f\u8ba1\u5145\u503c (USD)",
    "Top-up Today (USD)": "\u4eca\u65e5\u5145\u503c (USD)",
    "Redis Information": "Redis \u4fe1\u606f",
    "Version number:": "\u7248\u672c\u53f7\uff1a",
    "Port number:": "\u7aef\u53e3\u53f7\uff1a",
    "Number of running days:": "\u8fd0\u884c\u5929\u6570\uff1a",
    "Clusters or not:": "\u662f\u5426\u96c6\u7fa4\uff1a",
    "Persistence method:": "\u6301\u4e45\u5316\u65b9\u5f0f\uff1a",
    "Connected clients:": "\u5df2\u8fde\u63a5\u5ba2\u6237\u7aef\uff1a",
    "Total memory:": "\u603b\u5185\u5b58\uff1a",
    "Used memory:": "\u5df2\u7528\u5185\u5b58\uff1a",
    "Command Statistics": "\u547d\u4ee4\u7edf\u8ba1",
    "Number of Redis Keys": "Redis \u952e\u6570\u91cf",
    "No": "\u5426",
    "Placeholder content for the Asset Management admin page.": "\u8d44\u4ea7\u7ba1\u7406\u9875\u9762\u5185\u5bb9\u5360\u4f4d\u3002"
  };

  function translateText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return value;
    if (zhText[text]) return zhText[text];
    if (text.startsWith("Home / ")) {
      return text.split(" / ").map((part) => zhText[part] || part).join(" / ");
    }
    return value;
  }

  function applyAdminLanguage() {
    const language = localStorage.getItem(ADMIN_LANGUAGE_KEY) || "zh-CN";
    document.documentElement.lang = language === "zh-CN" ? "zh-CN" : "en";
    const languageButton = $$(".admin-profile .icon-button").find((button) => button.getAttribute("onclick")?.includes("changeLanguage"));
    if (languageButton) {
      languageButton.textContent = language === "zh-CN" ? "English" : "\u4e2d\u6587";
      languageButton.setAttribute("title", language === "zh-CN" ? "Switch to English" : "\u5207\u6362\u4e3a\u4e2d\u6587");
      languageButton.setAttribute("aria-label", languageButton.getAttribute("title"));
    }
    if (language !== "zh-CN") return;

    $$("input[placeholder], textarea[placeholder]").forEach((control) => {
      const translated = translateText(control.getAttribute("placeholder"));
      if (translated !== control.getAttribute("placeholder")) control.setAttribute("placeholder", translated);
    });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script, style, textarea, input, [contenteditable='true']")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const translated = translateText(node.nodeValue);
      if (translated !== node.nodeValue) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated);
    });
  }

  function bindAdminLanguage() {
    window.changeLanguage = function () {
      const current = localStorage.getItem(ADMIN_LANGUAGE_KEY) || "zh-CN";
      localStorage.setItem(ADMIN_LANGUAGE_KEY, current === "zh-CN" ? "en" : "zh-CN");
      location.reload();
    };
    clearTimeout(bindAdminLanguage.timer);
    bindAdminLanguage.timer = setTimeout(applyAdminLanguage, 0);
  }

  function getUserTransactions(type) {
    return Object.values(readUsers()).flatMap((user) => (user.transactions || [])
      .filter((tx) => tx.type === type)
      .map((tx) => ({
        account: user.username,
        name: user.username,
        network: "Local",
        currency: tx.asset || "USD",
        address: "local-account",
        amount: tx.amount,
        time: tx.time,
        status: tx.status || "Pending"
      })));
  }

  function normalizeIcons() {
    $$(".admin-search .search-icon").forEach((node) => {
      node.textContent = "Search";
      node.setAttribute("aria-hidden", "true");
    });

    $$(".admin-profile .icon-button").forEach((button) => {
      const text = button.textContent.trim();
      if (!text || /[ÃƒÃ°Ã¢Ã¤]/.test(text)) {
        button.textContent = button.getAttribute("onclick") ? "\u4e2d\u6587" : "Settings";
      }
      if (button.getAttribute("onclick")?.includes("changeLanguage")) {
        button.setAttribute("title", "Switch to Chinese");
        button.setAttribute("aria-label", "Switch to Chinese");
      }
    });

    $$(".table-btn").forEach((button) => {
      const text = button.textContent.toLowerCase();
      if (text.includes("query") || /[ÃƒÃ°]/.test(text)) button.textContent = "Query";
      if (text.includes("table") || text.includes("control")) button.textContent = "Table Control";
    });

    $$(".empty-box").forEach((box) => {
      const label = $("p", box)?.textContent?.replace("No Date", "No Data") || "No Data";
      box.innerHTML = `<div class="empty-icon">No records</div><p>${label}</p>`;
    });

    $$("td").forEach((cell) => {
      if (cell.closest("#ll-body") || cell.querySelector("[data-action='delete']")) return;
      if (/[ÃƒÃ°Ã¢]/.test(cell.textContent)) {
        cell.innerHTML = '<button class="row-action" data-action="view">View</button><button class="row-action" data-action="edit">Edit</button>';
      }
    });
  }

  function normalizeActionButtons() {
    $$("button[data-action], .icon-button[data-action]").forEach((button) => {
      button.classList.add("row-action");
      const action = button.dataset.action || "";
      if (action === "view") button.textContent = "View";
      if (action === "edit") button.textContent = "Edit";
      if (action === "delete") button.textContent = "Delete";
      if (action === "reset") button.textContent = "Reset";
      if (action === "kick") button.textContent = "Logout";
    });

    $$("table").forEach((table) => {
      if ($("tbody", table)?.id === "ll-body") return;
      const hasActionHeader = $$("thead th", table).some((th) => /operation|action/i.test(th.textContent));
      if (!hasActionHeader) return;
      $$("tbody tr", table).forEach((row) => {
        if (row.querySelector(".empty-box")) return;
        const cells = $$("td", row);
        if (!cells.length) return;
        const actionCell = cells[cells.length - 1];
        if (!actionCell.querySelector(".row-action")) {
          actionCell.innerHTML = '<button class="row-action" data-action="view">View</button><button class="row-action" data-action="edit">Edit</button><button class="row-action" data-action="delete">Delete</button>';
          return;
        }
        if (!actionCell.querySelector('[data-action="delete"]')) {
          actionCell.insertAdjacentHTML("beforeend", ' <button class="row-action" data-action="delete">Delete</button>');
        }
      });
    });
  }

  const forexHeaderRoutes = new Map([
    ["Primary certification", "primary-real-name.html"],
    ["Advanced Certification", "advanced-real-name.html"],
    ["Withdrawal Review", "new-withdrawal-records.html"],
    ["Currency orders", "currency-order-records.html"],
    ["Recharge Review", "recharge-review.html"]
  ]);

  function setActiveNavigation() {
    $$(".admin-menu a").forEach((link) => {
      const active = link.getAttribute("href") === pageName;
      link.classList.toggle("active", active);
      link.closest(".admin-submenu-item")?.classList.toggle("active", active);
      if (active) {
        const details = link.closest("details");
        if (details) details.open = true;
        details?.querySelector(".admin-menu-item")?.classList.add("active");
      }
    });
  }

  function bindMenuSearch() {
    const input = $(".admin-search input");
    if (!input) return;
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      $$(".admin-menu-group").forEach((group) => {
        const links = $$("a", group);
        const matched = !query || links.some((link) => link.textContent.toLowerCase().includes(query));
        group.style.display = matched ? "" : "none";
        if (query && matched) group.open = true;
      });
    });
  }

  function updateDashboardCards() {
    const cards = $$(".admin-card");
    if (!cards.length) return;
    const users = Object.values(readUsers());
    const today = new Date().toLocaleDateString();
    const userTransactions = users.flatMap((user) => user.transactions || []);
    const totalTopUp = userTransactions
      .filter((tx) => tx.type === "Deposit" && (tx.asset || "USD") === "USD")
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const topUpToday = userTransactions
      .filter((tx) => tx.type === "Deposit" && (tx.asset || "USD") === "USD" && new Date(tx.time).toLocaleDateString() === today)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const newUsersToday = users.filter((user) => {
      const created = user.createdAt || user.created || user.transactions?.[user.transactions.length - 1]?.time;
      return created && new Date(created).toLocaleDateString() === today;
    }).length;
    const values = [
      users.length,
      newUsersToday,
      money(totalTopUp),
      money(topUpToday)
    ];
    cards.forEach((card, index) => {
      const value = $(".card-value", card);
      if (value) value.textContent = values[index] ?? value.textContent;
    });
  }

  async function updateDashboardCardsFromServer() {
    const cards = $$(".admin-card");
    if (!cards.length) return;
    try {
      const today = localDateString();
      const data = await adminApi("admin_stats", { date: today });
      const stats = data.stats || {};
      const targetDate = stats.currentDate || today;
      let newUsersToday = Number(stats.newUsersToday || 0);

      const usersData = await adminApi("admin_users");
      const users = usersData.users || [];
      const rowCount = users.filter((user) => dateOnly(user.created) === targetDate).length;
      newUsersToday = rowCount || newUsersToday;

      const values = [
        Number(stats.totalUsers || users.length || 0).toLocaleString(),
        newUsersToday.toLocaleString(),
        money(stats.totalTopUp || 0),
        money(stats.topUpToday || 0)
      ];
      cards.forEach((card, index) => {
        const value = $(".card-value", card);
        if (value) value.textContent = values[index] ?? value.textContent;
      });
    } catch {
      console.warn("Unable to load MySQL dashboard stats; showing local registered-user fallback only.");
    }
  }

  function tableKey(index) {
    return `adminTable:${pageName}:${index}`;
  }

  function captureTable(table) {
    return {
      rows: $$("tbody tr", table)
        .filter((row) => !row.querySelector(".empty-box"))
        .filter((row) => row.textContent.trim().toLowerCase() !== "no data")
        .map((row) => $$("td", row).map((cell) => cell.innerHTML.trim()))
    };
  }

  function renderStoredTable(table, data) {
    const tbody = $("tbody", table);
    if (!tbody || !data?.rows?.length) return;
    tbody.innerHTML = data.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  }

  function showEmptyTable(table, label = "No data") {
    const tbody = $("tbody", table);
    if (!tbody) return;
    const columnCount = $$("thead th", table).length || $$("tr:first-child td", tbody).length || 1;
    tbody.innerHTML = `<tr><td colspan="${columnCount}" style="color:#9ca3af">${label}</td></tr>`;
  }

  function saveTable(table) {
    const index = $$("table").indexOf(table);
    if (index >= 0) writeJSON(tableKey(index), captureTable(table));
  }

  function setRowEditing(row, editing) {
    row.classList.toggle("admin-row-edited", editing);
    $$("td", row).forEach((cell, index, cells) => {
      if (index === 0 && cell.querySelector("input[type='checkbox']")) return;
      if (index === cells.length - 1 && cell.querySelector(".row-action")) return;
      cell.contentEditable = editing ? "true" : "false";
    });
    const editButton = row.querySelector('.row-action[data-action="edit"]');
    if (editButton) editButton.textContent = editing ? "Save" : "Edit";
  }

  function persistTables() {
    $$("table").forEach((table, index) => {
      if ($("tbody", table)?.id === "ll-body") return;
      if ($("tbody", table)?.id === "account-table-body") return;
      const stored = readJSON(tableKey(index), null);
      if (stored?.rows?.length) {
        renderStoredTable(table, stored);
      }
    });
  }

  function transactionTableRows(type, records) {
    const isDeposit = type === "Deposit";
    const isNewWithdrawalPage = pageName === "new-withdrawal-records.html";
    const isWithdrawalPage = type === "Withdraw";
    return records.map((record) => {
      const reviewActions = isWithdrawalPage && record.status === "Pending" && record.id
        ? `<button class="row-action" data-action="approve-withdrawal" data-id="${record.id}">Approve</button><button class="row-action row-action-danger" data-action="fail-withdrawal" data-id="${record.id}">Fail</button><button class="row-action" data-action="view">View</button>`
        : isDeposit && record.status === "Pending" && record.id
        ? `<button class="row-action" data-action="approve-deposit" data-id="${record.id}">Approve</button><button class="row-action row-action-danger" data-action="fail-deposit" data-id="${record.id}">Reject</button><button class="row-action" data-action="view">View</button>`
        : `<button class="row-action" data-action="view">View</button><button class="row-action" data-action="edit">Edit</button>`;
      return `
        <tr>
        <td><input type="checkbox"></td>
        <td>${record.account}</td>
        <td>${record.name}</td>
        <td>${record.network}</td>
        <td>${record.currency}</td>
        ${isNewWithdrawalPage
          ? `<td>${record.address}</td><td>${record.type || "Withdraw"}</td><td>${money(record.amount)}</td><td>${record.status}</td><td>${record.time}</td><td>${record.detail || "-"}</td>`
          : isDeposit
          ? `<td>${record.address}</td><td>${money(record.amount)}</td><td>${record.detail || "Server"}</td><td>${record.time}</td><td>${record.status}</td>`
          : isWithdrawalPage
          ? `<td>${record.currency}</td><td>${record.address}</td><td>${money(record.amount)}</td><td>${record.time}</td>`
          : `<td>${record.currency}</td><td>${record.address}</td><td>${money(record.amount)}</td><td>${record.time}</td>`}
        <td>${reviewActions}</td>
      </tr>
      `;
    }).join("");
  }

  function renderUserTransactionTable(type) {
    const tbody = $(".withdraw-table tbody");
    if (!tbody) return;
    const records = getUserTransactions(type);
    if (!records.length) {
      showEmptyTable(tbody.closest("table"));
      return;
    }
    tbody.innerHTML = transactionTableRows(type, records);
    saveTable(tbody.closest("table"));
  }

  async function renderServerTransactionTable(type) {
    const tbody = $(".withdraw-table tbody");
    if (!tbody) return;
    try {
      const payload = { type };
      if (pageName === "new-withdrawal-records.html" && type === "Withdraw") {
        payload.status = "Pending";
      }
      if (pageName === "recharge-review.html" && type === "Deposit") {
        payload.status = "Pending";
      }
      const data = await adminApi("admin_transactions", payload);
      const records = data.transactions || [];
      if (!records.length) {
        showEmptyTable(tbody.closest("table"));
        return;
      }
      tbody.innerHTML = transactionTableRows(type, records);
    } catch {
      renderUserTransactionTable(type);
    }
  }

  function showRecordModal(entries) {
    document.querySelector('.admin-record-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'admin-record-modal';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '100001', display: 'grid', placeItems: 'center',
      padding: '20px', background: 'rgba(15, 23, 42, .62)'
    });
    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Transaction details');
    Object.assign(dialog.style, {
      width: 'min(680px, 100%)', maxHeight: 'min(760px, 90vh)', overflow: 'auto',
      boxSizing: 'border-box', padding: '24px', borderRadius: '14px', background: '#fff',
      color: '#172033', boxShadow: '0 24px 64px rgba(0, 0, 0, .32)'
    });
    const heading = document.createElement('h2');
    heading.textContent = 'Transaction details';
    heading.style.margin = '0 0 18px';
    const grid = document.createElement('dl');
    Object.assign(grid.style, { margin: '0', display: 'grid', gridTemplateColumns: 'minmax(130px, 35%) 1fr', gap: '10px 16px' });
    entries.forEach(({ label, value }) => {
      const term = document.createElement('dt');
      term.textContent = label;
      term.style.fontWeight = '700';
      const definition = document.createElement('dd');
      definition.textContent = value;
      Object.assign(definition.style, { margin: '0', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' });
      grid.append(term, definition);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    Object.assign(close.style, { marginTop: '22px', padding: '9px 18px', border: '0', borderRadius: '8px', background: '#2563eb', color: '#fff', fontWeight: '700', cursor: 'pointer' });
    const dismiss = () => overlay.remove();
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
    dialog.append(heading, grid, close);
    overlay.append(dialog);
    document.body.append(overlay);
    close.focus();
  }

  async function updatePendingReviewCounts() {
    try {
      const [withdrawals, deposits] = await Promise.all([
        adminApi("admin_transactions", { type: "Withdraw", status: "Pending" }),
        adminApi("admin_transactions", { type: "Deposit", status: "Pending" })
      ]);
      const withdrawalCount = (withdrawals.transactions || []).length;
      const depositCount = (deposits.transactions || []).length;
      $$(".admin-pill").forEach((button) => {
        if (/Withdrawal Review/i.test(button.textContent)) {
          button.textContent = `Withdrawal Review (${withdrawalCount})`;
        } else if (/Recharge Review/i.test(button.textContent)) {
          button.textContent = `Recharge Review (${depositCount})`;
        }
      });
    } catch {
      // Keep static header counts when the server is unavailable.
    }
  }

  function hydratePageData() {
    persistTables();
    const staticRecordPages = new Set([
      "erupt-code.html",
      "feedback.html",
      "job-log.html",
      "new-withdrawal-records.html",
      "recharge-review.html",
      "top-up-records.html",
      "user-level.html",
      "user-invitation-records.html",
      "withdrawal-records.html"
    ]);
    if (staticRecordPages.has(pageName)) {
      $$("table").forEach((table) => showEmptyTable(table));
    }
    if (pageName === "withdrawal-records.html" || pageName === "new-withdrawal-records.html") {
      renderUserTransactionTable("Withdraw");
      renderServerTransactionTable("Withdraw");
    }
    if (pageName === "recharge-review.html" || pageName === "top-up-records.html") {
      renderUserTransactionTable("Deposit");
      renderServerTransactionTable("Deposit");
    }
  }

  function bindHeaderActions() {
    $$(".admin-pill").forEach((button) => {
      const text = button.textContent;
      const route = Array.from(forexHeaderRoutes.entries()).find(([label]) => text.includes(label));
      if (route) button.dataset.adminRoute = route[1];
      button.addEventListener("click", () => {
        if (button.dataset.adminRoute) window.location.href = button.dataset.adminRoute;
      });
    });
  }

  function filterTable(panel) {
    const filter = $(".filter-row", panel);
    if (!filter) return;
    const controls = $$("input, select", filter).filter((control) => control.type !== "checkbox");
    let visible = 0;
    $$("tbody tr", panel).forEach((row) => {
      if (row.querySelector(".empty-box")) return;
      const text = row.textContent.toLowerCase();
      const show = controls.every((control) => {
        const value = control.value.trim().toLowerCase();
        return !value || text.includes(value);
      });
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    showToast(`Showing ${visible} record${visible === 1 ? "" : "s"}.`);
  }

  function buildColumnPanel(panel) {
    let picker = $(".column-picker", panel);
    if (picker) {
      picker.remove();
      return;
    }
    const table = $("table", panel);
    if (!table) return;
    picker = document.createElement("div");
    picker.className = "column-picker";
    picker.innerHTML = $$("thead th", table).map((th, index) => `
      <label><input type="checkbox" checked data-column-index="${index}"> ${th.textContent.trim() || "Select"}</label>
    `).join("");
    $(".table-tools", panel)?.after(picker);
    picker.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-column-index]");
      if (!input) return;
      const column = Number(input.dataset.columnIndex) + 1;
      $$(`tr > *:nth-child(${column})`, table).forEach((cell) => {
        cell.style.display = input.checked ? "" : "none";
      });
    });
  }

  function bindTables() {
    $$(".admin-panel").forEach((panel) => {
      $$(".table-btn", panel).forEach((button) => {
        const text = button.textContent.toLowerCase();
        if (text.includes("query")) button.addEventListener("click", () => filterTable(panel));
        if (text.includes("table control")) button.addEventListener("click", () => buildColumnPanel(panel));
      });
      $$(".filter-row input, .filter-row select", panel).forEach((control) => {
        control.addEventListener("input", () => filterTable(panel));
        control.addEventListener("change", () => filterTable(panel));
      });
    });

    $$("thead input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const table = checkbox.closest("table");
        $$("tbody input[type='checkbox']", table).forEach((box) => {
          box.checked = checkbox.checked;
        });
      });
    });

    document.addEventListener("click", (event) => {
      const action = event.target.closest(".row-action");
      if (!action) return;
      if (action.closest("#ll-body") || action.closest("#user-table-body") || action.closest("#account-table-body") || action.closest("#verification-table-body")) return;
      const row = action.closest("tr");
      if (!row) return;
      const table = row.closest("table");
      if (action.dataset.action === "approve-withdrawal" || action.dataset.action === "fail-withdrawal") {
        const nextStatus = action.dataset.action === "approve-withdrawal" ? "Completed" : "Failed";
        if (!confirm(`Mark this withdrawal as ${nextStatus.toLowerCase()}?`)) return;
        adminApi("admin_review_withdrawal", { id: Number(action.dataset.id), status: nextStatus })
          .then(() => {
            showToast(`Withdrawal marked ${nextStatus.toLowerCase()}.`);
            renderServerTransactionTable("Withdraw");
            updatePendingReviewCounts();
          })
          .catch((error) => {
            showToast(error.message || "Unable to review withdrawal.", "error");
          });
        return;
      }
      if (action.dataset.action === "approve-deposit" || action.dataset.action === "fail-deposit") {
        const nextStatus = action.dataset.action === "approve-deposit" ? "Completed" : "Failed";
        if (!confirm(`Mark this recharge as ${nextStatus.toLowerCase()}?`)) return;
        adminApi("admin_review_deposit", { id: Number(action.dataset.id), status: nextStatus })
          .then(() => {
            showToast(`Recharge marked ${nextStatus.toLowerCase()}.`);
            renderServerTransactionTable("Deposit");
            updatePendingReviewCounts();
          })
          .catch((error) => showToast(error.message || "Unable to review recharge.", "error"));
        return;
      }
      if (action.dataset.action === "delete") {
        if (!confirm("Delete this record?")) return;
        row.remove();
        if (table) saveTable(table);
        showToast("Record deleted.");
        return;
      }
      if (action.dataset.action === "edit") {
        const editing = !row.classList.contains("admin-row-edited");
        setRowEditing(row, editing);
        if (table) saveTable(table);
        showToast(editing ? "Edit mode enabled." : "Record saved.");
        return;
      }
      const headers = $$("thead th", table).map((th) => th.textContent.trim());
      const entries = $$("td", row)
        .map((td, index) => ({ label: headers[index] || `Field ${index + 1}`, value: td.textContent.trim() }))
        .filter((entry) => entry.value && entry.label);
      showRecordModal(entries);
      showToast(`Viewing record ${entries[0]?.value || ""}.`);
    });

    $$(".pagination button").forEach((button) => {
      button.addEventListener("click", () => {
        $$(".pagination button").forEach((item) => item.classList.toggle("active", item === button));
        showToast(`Page ${button.textContent.trim()} selected.`);
      });
    });
  }

  function bindGenericForms() {
    $$("form").forEach((form) => {
      if (form.id === "loginForm") return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formKey = `adminTable:${pageName}:form:${form.id || $$("form").indexOf(form)}`;
        const values = {};
        $$("input, select, textarea", form).forEach((control) => {
          const key = control.name || control.id || control.placeholder || `field_${Object.keys(values).length + 1}`;
          values[key] = control.type === "checkbox" ? control.checked : control.value;
        });
        writeJSON(formKey, values);
        showToast("Saved successfully.");
      });
    });
  }

  function exposeStore() {
    window.AdminStore = {
      api: adminApi,
      read: readJSON,
      write: writeJSON,
      users: readUsers,
      accounts: readAdminAccounts,
      transactions: getUserTransactions
    };
  }

  function init() {
    exposeStore();
    bindServerStorage();
    syncAdminStorageFromServer();
    hydratePageData();
    normalizeIcons();
    normalizeActionButtons();
    setActiveNavigation();
    bindMenuSearch();
    updateDashboardCards();
    bindHeaderActions();
    bindTables();
    bindGenericForms();
    updateDashboardCardsFromServer();
    updatePendingReviewCounts();
    bindAdminLanguage();
    const observer = new MutationObserver(() => {
      clearTimeout(bindAdminLanguage.timer);
      bindAdminLanguage.timer = setTimeout(applyAdminLanguage, 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();




