const DemoExchange = (() => {
  const USERS_KEY = "demoExchangeUsers";
  const SESSION_KEY = "demoExchangeSession";
  const USER_LOG_KEY = "userLoginLog";
  const API_URL = "api/index.php";
  let authMode = "login";
  let walletMode = "Exchange";
  let tradeHistoryMode = "Position order";
  const prices = {
    BTC: 63670.71,
    ETH: 3420.35,
    EUR: 1.0845,
    JPY: 147.82
  };

  function readUsers() {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
  }

  function writeUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  async function apiRequest(action, payload = {}) {
    const response = await fetch(API_URL, {
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

  function backendUnavailable(error) {
    const message = error?.message || "";
    return message.includes("Failed to fetch")
      || message.includes("Server request failed")
      || message.includes("SQLSTATE")
      || message.includes("Access denied")
      || message.includes("Unknown database")
      || message.includes("your_database_");
  }

  function cacheServerUser(user) {
    if (!user?.username) return;
    const users = readUsers();
    users[user.username] = user;
    writeUsers(users);
    localStorage.setItem(SESSION_KEY, user.username);
  }

  async function syncCurrentUser() {
    if (!currentUsername()) return;
    try {
      const data = await apiRequest("me");
      cacheServerUser(data.user);
    } catch {
      // Keep local development usable when PHP/MySQL is not configured yet.
    }
  }

  function addUserLog(username, action, status) {
    const logs = JSON.parse(localStorage.getItem(USER_LOG_KEY) || "[]");
    logs.unshift({
      id: "UL" + Date.now(),
      user: username || "unknown",
      login: new Date().toLocaleString(),
      ip: "local",
      source: "Local browser",
      os: navigator.platform || "Unknown",
      browser: navigator.userAgent.includes("Chrome") ? "Chrome" : "Browser",
      type: /Mobi|Android/i.test(navigator.userAgent) ? "Mobile" : "Computer",
      action,
      status
    });
    localStorage.setItem(USER_LOG_KEY, JSON.stringify(logs.slice(0, 100)));
  }

  function currentUsername() {
    return localStorage.getItem(SESSION_KEY);
  }

  function getUser() {
    const username = currentUsername();
    if (!username) return null;
    const users = readUsers();
    const user = users[username] || null;
    if (!user) return null;

    const oldCreditIndex = user.transactions?.findIndex((tx) => tx.type === "Demo Credit" && tx.detail === "Starting demo balance") ?? -1;
    if (oldCreditIndex >= 0) {
      user.transactions.splice(oldCreditIndex, 1);
      user.balances.USDT = Math.max(0, Number(user.balances.USDT || 0) - 10000);
      users[username] = user;
      writeUsers(users);
    }

    return user;
  }

  function saveUser(user) {
    const users = readUsers();
    users[user.username] = user;
    writeUsers(users);
  }

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function coin(value) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8
    });
  }

  function addTransaction(user, type, asset, amount, status, detail) {
    user.transactions.unshift({
      id: "TX" + Date.now(),
      type,
      asset,
      amount: Number(amount),
      status,
      detail,
      time: new Date().toLocaleString()
    });
    user.transactions = user.transactions.slice(0, 50);
    saveUser(user);
  }

  function portfolioValue(user) {
    if (!user) return 0;
    return Object.entries(user.balances).reduce((total, [asset, amount]) => {
      if (asset === "USDT") return total + amount;
      return total + amount * (prices[asset] || 1);
    }, 0);
  }

  async function createUser(username, phone, password) {
    const users = readUsers();
    if (!/^\d+$/.test(phone)) throw new Error("Phone number must contain numbers only.");
    if (users[username]) throw new Error("Username already exists.");

    try {
      const data = await apiRequest("register", { username, phone, password });
      cacheServerUser(data.user);
      return;
    } catch (error) {
      if (!backendUnavailable(error)) {
        throw error;
      }
    }

    const user = {
      username,
      phone,
      password,
      createdAt: new Date().toISOString(),
      balances: { USDT: 0, BTC: 0, ETH: 0, EUR: 0, JPY: 0 },
      transactions: []
    };

    users[username] = user;
    writeUsers(users);
    localStorage.setItem(SESSION_KEY, username);
    addUserLog(username, "Register", "Success");
  }

  async function login(username, password) {
    try {
      const data = await apiRequest("login", { username, password });
      cacheServerUser(data.user);
      addUserLog(username, "Login", "Success");
      return;
    } catch (error) {
      if (!backendUnavailable(error)) {
        addUserLog(username, "Login", "Failed");
        throw error;
      }
    }

    const user = readUsers()[username];
    if (!user || user.password !== password) {
      addUserLog(username, "Login", "Failed");
      throw new Error("Invalid username or password.");
    }
    localStorage.setItem(SESSION_KEY, username);
    addUserLog(username, "Login", "Success");
  }

  function logout() {
    apiRequest("logout").catch(() => {});
    localStorage.removeItem(SESSION_KEY);
  }

  function resetDemo() {
    const user = getUser();
    if (!user) return;
    user.balances = { USDT: 0, BTC: 0, ETH: 0, EUR: 0, JPY: 0 };
    user.transactions = [];
    saveUser(user);
  }

  async function trade(asset, side, usdtAmount) {
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");

    const amount = Number(usdtAmount);
    if (!amount || amount <= 0) throw new Error("Enter a valid USDT amount.");
    if (user.balances.USDT < amount) throw new Error("Not enough USDT.");

    const units = amount / prices[asset];

    try {
      const data = await apiRequest("trade", { asset, side, amount });
      cacheServerUser(data.user);
      return { user: data.user, units: data.units };
    } catch (error) {
      if (!backendUnavailable(error)) {
        throw error;
      }
    }

    user.balances.USDT -= amount;
    if (side.toLowerCase().includes("short")) {
      addTransaction(user, side, asset, units, "Open", `${side} ${asset}/USDT margin at ${money(prices[asset])}`);
      return { user, units };
    }

    user.balances[asset] = (user.balances[asset] || 0) + units;
    addTransaction(user, side, asset, units, "Filled", `${side} ${asset}/USDT at ${money(prices[asset])}`);
    return { user, units };
  }

  async function walletAction(type, amount, asset = "USDT") {
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("Enter a valid amount.");

    try {
      const data = await apiRequest("wallet_action", { type, amount: value, asset });
      cacheServerUser(data.user);
      return;
    } catch (error) {
      if (!backendUnavailable(error)) {
        throw error;
      }
    }

    if (type === "Deposit") {
      user.balances[asset] = (user.balances[asset] || 0) + value;
      addTransaction(user, "Deposit", asset, value, "Completed", "Funds added");
      return;
    }

    if (type === "Withdraw") {
      if ((user.balances[asset] || 0) < value) throw new Error("Insufficient balance.");
      user.balances[asset] -= value;
      addTransaction(user, "Withdraw", asset, value, "Pending", "Withdrawal request");
      return;
    }

    if (type === "Transfer") {
      addTransaction(user, "Transfer", asset, value, "Completed", "Moved between wallets");
      return;
    }

    if (type === "Loan") {
      user.balances.USDT += value;
      addTransaction(user, "Loan", "USDT", value, "Approved", "Credit line");
      return;
    }

    saveUser(user);
  }

  async function exchange(fromAsset, toAsset, amount) {
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("Enter a valid amount.");
    if ((user.balances[fromAsset] || 0) < value) throw new Error("Insufficient balance.");

    try {
      const data = await apiRequest("exchange", { fromAsset, toAsset, amount: value });
      cacheServerUser(data.user);
      return;
    } catch (error) {
      if (!backendUnavailable(error)) {
        throw error;
      }
    }

    const fromUsdt = fromAsset === "USDT" ? value : value * prices[fromAsset];
    const received = toAsset === "USDT" ? fromUsdt : fromUsdt / prices[toAsset];
    user.balances[fromAsset] -= value;
    user.balances[toAsset] = (user.balances[toAsset] || 0) + received;
    addTransaction(user, "Exchange", `${fromAsset}/${toAsset}`, received, "Completed", `${coin(value)} ${fromAsset} converted`);
  }

  function transactionRows(user, mode = "all") {
    let transactions = user?.transactions || [];
    if (mode === "Position order") {
      transactions = transactions.filter((tx) => tx.status === "Open" || tx.status === "Filled");
    } else if (mode === "Profit order") {
      transactions = transactions.filter((tx) => tx.type.toLowerCase().includes("profit") || tx.detail.toLowerCase().includes("profit"));
    }

    if (!transactions.length) {
      return '<div class="empty-state">No transactions yet</div>';
    }

    return transactions.map((tx) => `
      <div class="transaction-row">
        <div>
          <strong>${tx.type}</strong>
          <span>${tx.detail}</span>
        </div>
        <div>
          <strong>${coin(tx.amount)} ${tx.asset}</strong>
          <span>${tx.status} - ${tx.time}</span>
        </div>
      </div>
    `).join("");
  }

  function applyAccountModalStyles() {
    const modal = document.querySelector(".demo-account-modal");
    const panel = document.querySelector(".demo-account-panel");
    const top = document.querySelector(".demo-account-panel .demo-panel-top");
    const closeButton = document.querySelector(".demo-account-panel .demo-close");
    if (modal) {
      Object.assign(modal.style, {
        position: "fixed",
        inset: "0",
        zIndex: "100000",
        alignItems: "center",
        justifyContent: "center",
        padding: "18px",
        background: "rgba(2, 6, 23, 0.72)",
        backdropFilter: "blur(10px)"
      });
    }
    if (panel) {
      Object.assign(panel.style, {
        width: "min(560px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 32px)",
        margin: "0",
        padding: "20px",
        borderRadius: "22px",
        background: "#0f172a",
        border: "1px solid rgba(56, 189, 248, 0.22)",
        boxShadow: "0 24px 70px rgba(0, 0, 0, 0.45)",
        color: "#e2e8f0",
        overflowY: "auto"
      });
    }
    if (top) {
      Object.assign(top.style, {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "16px",
        paddingBottom: "14px",
        marginBottom: "12px",
        borderBottom: "1px solid rgba(148, 163, 184, 0.16)"
      });
    }
    if (closeButton) {
      Object.assign(closeButton.style, {
        flex: "0 0 auto",
        width: "36px",
        height: "36px",
        display: "grid",
        placeItems: "center",
        padding: "0",
        border: "0",
        borderRadius: "12px",
        background: "rgba(148, 163, 184, 0.16)",
        color: "#f8fafc",
        cursor: "pointer",
        fontSize: "16px",
        lineHeight: "1"
      });
    }
    document.querySelectorAll(".demo-account-panel .demo-copy").forEach((node) => {
      Object.assign(node.style, {
        display: "grid",
        gap: "4px",
        marginBottom: "12px"
      });
    });
    document.querySelectorAll(".demo-account-panel .auth-switch").forEach((switcher) => {
      Object.assign(switcher.style, {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "8px",
        padding: "6px",
        marginBottom: "12px",
        borderRadius: "16px",
        background: "rgba(148, 163, 184, 0.08)"
      });
    });
    document.querySelectorAll(".demo-account-panel .auth-switch-button").forEach((button) => {
      const isActive = button.classList.contains("active");
      Object.assign(button.style, {
        minHeight: "42px",
        border: "0",
        borderRadius: "12px",
        background: isActive ? "rgba(56, 189, 248, 0.22)" : "transparent",
        color: isActive ? "#ffffff" : "#94a3b8",
        fontWeight: "800",
        cursor: "pointer"
      });
    });
    document.querySelectorAll(".demo-account-panel .auth-form").forEach((form) => {
      Object.assign(form.style, {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "10px",
        width: "100%",
        margin: "0 0 12px",
        padding: "14px",
        borderRadius: "18px",
        background: "rgba(8, 14, 31, 0.78)",
        border: "1px solid rgba(148, 163, 184, 0.12)"
      });
    });
    document.querySelectorAll(".demo-account-panel input").forEach((input) => {
      Object.assign(input.style, {
        display: "block",
        width: "100%",
        minWidth: "0",
        height: "46px",
        padding: "0 14px",
        borderRadius: "14px",
        border: "1px solid rgba(148, 163, 184, 0.24)",
        background: "#111827",
        color: "#f8fafc",
        outline: "none",
        boxSizing: "border-box"
      });
    });
    document.querySelectorAll(".demo-account-panel .auth-form button, .demo-account-panel .demo-actions button").forEach((button) => {
      Object.assign(button.style, {
        width: "100%",
        minHeight: "46px",
        padding: "0 16px",
        border: "0",
        borderRadius: "14px",
        background: "#2563eb",
        color: "#ffffff",
        fontWeight: "700",
        cursor: "pointer"
      });
    });
  }

  function renderAccountPanel() {
    const existingPanel = document.querySelector(".demo-account-panel");
    if (existingPanel) {
      const existingModal = existingPanel.closest(".demo-account-modal");
      if (existingModal) {
        existingModal.hidden = true;
        existingModal.style.display = "none";
      }
      applyAccountModalStyles();
      return;
    }

    const modal = document.createElement("div");
    modal.className = "demo-account-modal";
    modal.hidden = true;
    modal.style.display = "none";
    modal.innerHTML = '<section class="demo-account-panel" role="dialog" aria-modal="true" aria-label="Currency account"></section>';
    document.body.appendChild(modal);
    applyAccountModalStyles();

    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeAccountPanel();
    });

    drawAccountPanel();
  }

  function drawAccountPanel(message = "") {
    const panel = document.querySelector(".demo-account-panel");
    if (!panel) return;
    const user = getUser();

    if (!user) {
      const isRegister = authMode === "register";
      panel.innerHTML = `
        <div class="demo-panel-top">
          <div>
            <strong>${isRegister ? "Create account" : "Login"}</strong>
            <span>${isRegister ? "Register with a phone number." : "Access your currency account."}</span>
          </div>
          <button type="button" class="demo-close" aria-label="Close">x</button>
        </div>
        <div class="auth-switch" role="tablist" aria-label="Account action">
          <button type="button" class="auth-switch-button ${!isRegister ? "active" : ""}" data-auth-mode="login">Login</button>
          <button type="button" class="auth-switch-button ${isRegister ? "active" : ""}" data-auth-mode="register">Register</button>
        </div>
        <div class="demo-copy">
          <strong>Currency account</strong>
          <span>${isRegister ? "Create your account to view currency balances." : "Login to view your currency balances and history."}</span>
        </div>
        ${isRegister ? `
          <form class="auth-form" id="registerForm">
            <input id="registerUsername" type="text" placeholder="Username" required>
            <input id="registerPhone" type="tel" inputmode="numeric" pattern="[0-9]*" placeholder="Phone number" required>
            <input id="registerPassword" type="password" placeholder="Password" required>
            <button type="submit">Register</button>
          </form>
        ` : `
          <form class="auth-form compact" id="loginForm">
            <input id="loginUsername" type="text" placeholder="Username" required>
            <input id="loginPassword" type="password" placeholder="Password" required>
            <button type="submit">Login</button>
          </form>
        `}
        <div class="demo-message">${message}</div>
      `;
      applyAccountModalStyles();
      bindPanelClose();
      bindAuthSwitch();
      bindAuthForms();
      return;
    }

    panel.innerHTML = `
      <div class="demo-panel-top">
        <div>
          <strong>Currency account</strong>
          <span>Currency account</span>
        </div>
        <button type="button" class="demo-close" aria-label="Close">x</button>
      </div>
      <div class="demo-copy">
        <strong>${user.username}</strong>
        <span>Portfolio: ${money(portfolioValue(user))} USDT</span>
      </div>
      <div class="demo-balances">
        <span>USDT ${money(user.balances.USDT)}</span>
        <span>BTC ${coin(user.balances.BTC)}</span>
        <span>ETH ${coin(user.balances.ETH)}</span>
      </div>
      <div class="demo-actions">
        <button type="button" id="logoutDemo">Logout</button>
      </div>
      <div class="demo-message">${message}</div>
    `;
    applyAccountModalStyles();
    bindPanelClose();
    document.getElementById("logoutDemo").addEventListener("click", () => {
      logout();
      refresh("Logged out.");
    });
  }

  function bindPanelClose() {
    document.querySelector(".demo-close")?.addEventListener("click", closeAccountPanel);
  }

  function bindAuthSwitch() {
    document.querySelectorAll(".auth-switch-button").forEach((button) => {
      button.addEventListener("click", () => {
        authMode = button.dataset.authMode || "login";
        drawAccountPanel();
      });
    });
  }

  function openAccountPanel() {
    let modal = document.querySelector(".demo-account-modal");
    if (!modal) {
      renderAccountPanel();
      modal = document.querySelector(".demo-account-modal");
    }
    if (!modal) return;
    modal.hidden = false;
    modal.style.display = "flex";
    applyAccountModalStyles();
    modal.classList.add("open");
    document.body.classList.add("demo-modal-open");
  }

  function closeAccountPanel() {
    const modal = document.querySelector(".demo-account-modal");
    if (modal) {
      modal.classList.remove("open");
      modal.hidden = true;
      modal.style.display = "none";
    }
    document.body.classList.remove("demo-modal-open");
  }

  function bindAccountButtons() {
    document.querySelectorAll('.account-button, .icon-button[aria-label="Support"], .icon-button[aria-label="Login or register"]').forEach((button) => {
      button.setAttribute("aria-label", "Login or register");
      button.setAttribute("title", "Login or register");
      button.addEventListener("click", openAccountPanel);
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest(".account-button");
      if (!button) return;
      event.preventDefault();
      openAccountPanel();
    });
  }

  function bindAuthForms() {
    const registerForm = document.getElementById("registerForm");
    const loginForm = document.getElementById("loginForm");

    registerForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await createUser(
          document.getElementById("registerUsername").value.trim(),
          document.getElementById("registerPhone").value.trim(),
          document.getElementById("registerPassword").value
        );
        refresh("Registration successful.");
      } catch (error) {
        drawAccountPanel(error.message);
      }
    });

    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await login(
          document.getElementById("loginUsername").value.trim(),
          document.getElementById("loginPassword").value
        );
        refresh("Logged in.");
      } catch (error) {
        drawAccountPanel(error.message);
      }
    });
  }

  function applyTradeTicketStyles() {
    const ticket = document.querySelector(".status-card");
    if (!ticket) return;

    Object.assign(ticket.style, {
      display: "grid",
      gap: "14px",
      padding: "18px",
      borderRadius: "22px",
      background: "rgba(8, 14, 31, 0.94)",
      border: "1px solid rgba(148, 163, 184, 0.14)",
      color: "#e2e8f0"
    });

    document.querySelectorAll(".trade-ticket-header").forEach((header) => {
      Object.assign(header.style, {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "16px",
        paddingBottom: "14px",
        borderBottom: "1px solid rgba(148, 163, 184, 0.14)"
      });
    });

    document.querySelectorAll(".mock-trade-form").forEach((form) => {
      Object.assign(form.style, {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "12px",
        padding: "14px",
        borderRadius: "18px",
        background: "rgba(15, 23, 42, 0.82)",
        border: "1px solid rgba(148, 163, 184, 0.12)"
      });
    });

    document.querySelectorAll(".mock-trade-form label").forEach((label) => {
      Object.assign(label.style, {
        display: "grid",
        gap: "6px",
        color: "#9fb3d1",
        fontSize: "0.9rem"
      });
    });

    document.querySelectorAll(".mock-trade-form input, .mock-trade-form select").forEach((control) => {
      Object.assign(control.style, {
        width: "100%",
        height: "48px",
        minWidth: "0",
        padding: "0 14px",
        borderRadius: "14px",
        border: "1px solid rgba(148, 163, 184, 0.24)",
        background: "#111827",
        color: "#f8fafc",
        outline: "none",
        boxSizing: "border-box"
      });
    });

    document.querySelectorAll(".mock-trade-form button").forEach((button) => {
      Object.assign(button.style, {
        gridColumn: "1 / -1",
        minHeight: "50px",
        padding: "0 16px",
        border: "0",
        borderRadius: "14px",
        background: "linear-gradient(135deg, #14b8a6, #2563eb)",
        color: "#ffffff",
        fontWeight: "800",
        cursor: "pointer"
      });
    });

    document.querySelectorAll("#tradeTransactions .transaction-row").forEach((row) => {
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.25fr) minmax(160px, 0.75fr)",
        gap: "12px",
        alignItems: "center",
        padding: "14px",
        borderRadius: "16px",
        background: "rgba(15, 23, 42, 0.78)",
        border: "1px solid rgba(148, 163, 184, 0.12)"
      });
    });

    if (window.matchMedia("(max-width: 780px)").matches) {
      document.querySelectorAll(".mock-trade-form, #tradeTransactions .transaction-row").forEach((node) => {
        node.style.gridTemplateColumns = "1fr";
      });
    }
  }

  function bindUserTabs() {
    const tabGroups = [
      ".market-selection",
      ".market-toggle",
      ".options-tabs",
      ".trade-mode-card",
      ".chart-toolbar",
      ".trade-tab-row"
    ];

    tabGroups.forEach((selector) => {
      document.querySelectorAll(selector).forEach((group) => {
        group.setAttribute("role", "tablist");
        group.querySelectorAll("button").forEach((button) => {
          button.setAttribute("role", "tab");
          button.setAttribute("aria-selected", button.classList.contains("active") ? "true" : "false");
          button.addEventListener("click", () => {
            group.querySelectorAll("button").forEach((item) => {
              const isActive = item === button;
              item.classList.toggle("active", isActive);
              item.setAttribute("aria-selected", isActive ? "true" : "false");
            });
            if (button.closest(".trade-tab-row")) {
              tradeHistoryMode = button.textContent.trim();
              renderTradeTransactions();
            }
            if (button.closest(".trade-mode-card")) {
              document.querySelector(".options-card .primary-button") && (document.querySelector(".options-card .primary-button").textContent = button.textContent.trim());
            }
            if (button.closest(".options-tabs")) {
              renderOptionsState(button.textContent.trim());
            }
            if (button.closest(".market-selection") || button.closest(".market-toggle")) {
              filterMarketRows();
            }
            if (button.closest(".chart-toolbar")) {
              updateChartLabel(button.textContent.trim());
            }
          });
        });
      });
    });
  }

  function filterMarketRows() {
    const query = document.querySelector(".search-box input")?.value.trim().toLowerCase() || "";
    const showAll = document.querySelector(".market-filter-item.active")?.textContent.trim() === "All";
    document.querySelectorAll(".market-list-card .market-row").forEach((row, index) => {
      const pair = row.querySelector(".pair-name")?.textContent.toLowerCase() || "";
      const matchesSearch = !query || pair.includes(query);
      const matchesFilter = showAll || index < 3;
      row.hidden = !(matchesSearch && matchesFilter);
    });
  }

  function bindMarketSearch() {
    document.querySelectorAll(".search-box input").forEach((input) => {
      input.addEventListener("input", filterMarketRows);
    });
    filterMarketRows();
  }

  function updateChartLabel(label) {
    const marker = document.querySelector(".chart-placeholder span");
    if (marker) marker.textContent = label === "Index" ? "Index" : "8.45k";
  }

  function renderOptionsState(mode = "Open") {
    const order = document.querySelector(".order-card p");
    if (!order) return;
    order.textContent = mode === "Position" ? "No open positions" : "No active orders";
  }

  function bindOptionsControls() {
    document.querySelectorAll(".risk-buttons button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".risk-buttons button").forEach((item) => item.classList.toggle("active", item === button));
      });
    });
    renderOptionsState();
  }

  function enhanceTradePage() {
    const status = document.querySelector(".status-card");
    if (!status) return;
    const user = getUser();
    const available = user ? money(user.balances.USDT) : "0.00";

    status.innerHTML = `
      <div class="trade-ticket-header">
        <div>
          <strong>Order ticket</strong>
          <span>Currency order</span>
        </div>
        <div class="trade-ticket-balance">
          <span>Available</span>
          <strong>${available} USDT</strong>
        </div>
      </div>
      <form class="mock-trade-form" id="mockTradeForm">
        <label>Pair
          <select id="tradeAsset">
            <option value="BTC">BTC/USDT</option>
            <option value="ETH">ETH/USDT</option>
          </select>
        </label>
        <label>Side
          <select id="tradeSide">
            <option value="Buy">Buy/long</option>
            <option value="Short">Buy/short</option>
          </select>
        </label>
        <label>Amount USDT
          <input id="tradeAmount" type="number" min="1" step="1" value="100">
        </label>
        <button type="submit">Place Order</button>
      </form>
      <div class="trade-result" id="tradeResult"></div>
      <div class="transaction-list" id="tradeTransactions"></div>
    `;
    applyTradeTicketStyles();

    document.querySelector(".trade-button.buy")?.addEventListener("click", () => {
      document.getElementById("tradeSide").value = "Buy";
      document.getElementById("tradeAmount").focus();
    });
    document.querySelector(".trade-button.sell")?.addEventListener("click", () => {
      document.getElementById("tradeSide").value = "Short";
      document.getElementById("tradeAmount").focus();
    });

    document.getElementById("mockTradeForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await trade(
          document.getElementById("tradeAsset").value,
          document.getElementById("tradeSide").value,
          document.getElementById("tradeAmount").value
        );
        document.getElementById("tradeResult").textContent = `Filled ${coin(result.units)} ${document.getElementById("tradeAsset").value}.`;
        refresh();
      } catch (error) {
        document.getElementById("tradeResult").textContent = error.message;
      }
    });

    renderTradeTransactions();
  }

  function renderTradeTransactions() {
    const list = document.getElementById("tradeTransactions");
    if (list) {
      list.innerHTML = transactionRows(getUser(), tradeHistoryMode);
      applyTradeTicketStyles();
    }
  }

  function enhanceOptionsPage() {
    const button = document.querySelector(".options-card .primary-button");
    if (!button) return;
    button.addEventListener("click", async () => {
      try {
        await trade("BTC", "Leveraged Buy", 100);
        refresh("Leveraged order opened.");
      } catch (error) {
        refresh(error.message);
      }
    });
  }

  function enhanceWalletPage() {
    const header = document.querySelector(".wallet-header");
    if (!header) return;

    document.querySelectorAll(".wallet-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        walletMode = tab.textContent.trim();
        document.querySelectorAll(".wallet-tab").forEach((item) => {
          item.classList.toggle("active", item === tab);
        });
        renderWallet();
      });
    });

    const panel = document.querySelector(".wallet-panel");
    const controls = document.querySelector(".wallet-controls");
    controls?.insertAdjacentHTML("afterend", '<section class="wallet-assets" id="walletAssets"></section>');
    panel?.insertAdjacentHTML("beforeend", `
      <section class="wallet-ledger">
        <div class="ledger-header">
          <strong>Transaction History</strong>
          <span>Currency records</span>
        </div>
        <div id="walletTransactions"></div>
      </section>
    `);

    document.querySelectorAll(".wallet-action").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.textContent.trim();
        try {
          if (action.includes("Withdraw")) {
            await walletAction("Withdraw", prompt("Withdrawal amount", "100"), "USDT");
          } else if (action.includes("Deposit")) {
            await walletAction("Deposit", prompt("Deposit amount", "500"), "USDT");
          } else if (action.includes("Transfer")) {
            await walletAction("Transfer", prompt("Transfer amount", "100"), "USDT");
          } else if (action.includes("Exchange")) {
            await exchange("USDT", "BTC", prompt("Convert USDT to BTC", "100"));
          } else if (action.includes("Loan")) {
            await walletAction("Loan", prompt("Loan amount", "1000"), "USDT");
          }
          refresh(`${action} transaction recorded.`);
        } catch (error) {
          refresh(error.message);
        }
      });
    });

    document.querySelector(".checkbox-row input")?.addEventListener("change", renderWallet);
    document.querySelector(".search-row input")?.addEventListener("input", renderWallet);

    renderWallet();
  }

  function applyWalletStyles() {
    const panel = document.querySelector(".wallet-panel");
    if (!panel) return;

    Object.assign(panel.style, {
      display: "grid",
      gap: "18px",
      padding: "18px",
      borderRadius: "24px"
    });

    document.querySelectorAll(".wallet-tabs").forEach((tabs) => {
      Object.assign(tabs.style, {
        display: "inline-grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "8px",
        width: "min(280px, 100%)",
        margin: "0",
        padding: "6px",
        borderRadius: "18px",
        background: "rgba(148, 163, 184, 0.07)"
      });
    });

    document.querySelectorAll(".wallet-tab").forEach((tab) => {
      const active = tab.classList.contains("active");
      Object.assign(tab.style, {
        minHeight: "42px",
        border: "0",
        borderRadius: "14px",
        background: active ? "linear-gradient(135deg, rgba(248, 179, 28, 0.34), rgba(56, 189, 248, 0.18))" : "transparent",
        color: active ? "#ffffff" : "#94a3b8",
        fontWeight: "800",
        cursor: "pointer"
      });
    });

    document.querySelectorAll(".wallet-status").forEach((status) => {
      Object.assign(status.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        margin: "0",
        padding: "16px 18px",
        borderRadius: "18px",
        background: "rgba(56, 189, 248, 0.1)",
        border: "1px solid rgba(56, 189, 248, 0.16)",
        textAlign: "left"
      });
    });

    document.querySelectorAll(".wallet-controls").forEach((controls) => {
      Object.assign(controls.style, {
        display: "grid",
        gridTemplateColumns: "auto minmax(220px, 1fr)",
        alignItems: "center",
        gap: "14px"
      });
    });

    document.querySelectorAll(".checkbox-row").forEach((row) => {
      Object.assign(row.style, {
        display: "inline-flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "10px",
        minHeight: "48px",
        padding: "0 14px",
        borderRadius: "16px",
        background: "rgba(148, 163, 184, 0.08)",
        color: "#e2e8f0"
      });
    });

    document.querySelectorAll(".search-row").forEach((row) => {
      Object.assign(row.style, {
        minHeight: "48px",
        padding: "0 16px",
        borderRadius: "16px",
        background: "rgba(148, 163, 184, 0.08)"
      });
    });

    document.querySelectorAll(".wallet-assets, #walletTransactions").forEach((list) => {
      Object.assign(list.style, {
        display: "grid",
        gap: "10px"
      });
    });

    document.querySelectorAll(".asset-row, #walletTransactions .transaction-row").forEach((row) => {
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.25fr) minmax(150px, 0.75fr)",
        alignItems: "center",
        gap: "12px",
        padding: "14px",
        borderRadius: "16px",
        background: "rgba(8, 14, 31, 0.72)",
        border: "1px solid rgba(148, 163, 184, 0.12)"
      });
    });

    if (window.matchMedia("(max-width: 700px)").matches) {
      document.querySelectorAll(".wallet-controls, .asset-row, #walletTransactions .transaction-row").forEach((node) => {
        node.style.gridTemplateColumns = "1fr";
      });
    }
  }

  function renderWallet() {
    const user = getUser();
    const value = walletMode === "Futures" ? 0 : portfolioValue(user);
    document.querySelectorAll(".wallet-amount, .wallet-summary-value").forEach((node) => {
      node.textContent = money(value);
    });
    document.querySelectorAll(".wallet-usd, .wallet-summary-usd").forEach((node) => {
      node.textContent = `approx $${money(value)}`;
    });
    const status = document.querySelector(".wallet-status-message");
    if (status) status.textContent = user ? `${walletMode} wallet active.` : "Please register or log in to use the currency wallet.";
    const ledgerLabel = document.querySelector(".ledger-header span");
    if (ledgerLabel) ledgerLabel.textContent = `${walletMode} records`;
    const ledger = document.getElementById("walletTransactions");
    if (ledger) ledger.innerHTML = transactionRows(user);
    const assets = document.getElementById("walletAssets");
    if (assets) {
      const query = document.querySelector(".search-row input")?.value.trim().toLowerCase() || "";
      const hideSmall = document.querySelector(".checkbox-row input")?.checked;
      const balances = user?.balances || { USDT: 0, BTC: 0, ETH: 0, EUR: 0, JPY: 0 };
      const rows = Object.entries(balances)
        .filter(([asset, amount]) => (!query || asset.toLowerCase().includes(query)) && (!hideSmall || Number(amount) > 0))
        .map(([asset, amount]) => {
          const value = asset === "USDT" ? amount : amount * (prices[asset] || 1);
          return `
            <div class="asset-row">
              <div>
                <strong>${asset}</strong>
                <span>${asset === "USDT" ? "Tether USD" : "Currency balance"}</span>
              </div>
              <div>
                <strong>${coin(amount)}</strong>
                <span>approx $${money(value)}</span>
              </div>
            </div>
          `;
        }).join("");
      assets.innerHTML = rows || '<div class="empty-state">No matching assets</div>';
    }
    applyWalletStyles();
  }

  function refresh(message = "") {
    drawAccountPanel(message);
    renderWallet();
    renderTradeTransactions();
  }

  async function init() {
    await syncCurrentUser();
    renderAccountPanel();
    bindAccountButtons();
    bindUserTabs();
    bindMarketSearch();
    bindOptionsControls();
    enhanceTradePage();
    enhanceOptionsPage();
    enhanceWalletPage();
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", DemoExchange.init);
