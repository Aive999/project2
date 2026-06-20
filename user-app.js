const DemoExchange = (() => {
  const USERS_KEY = "demoExchangeUsers";
  const SESSION_KEY = "demoExchangeSession";
  const USER_LOG_KEY = "userLoginLog";
  const API_URL = "api/index.php";
  let accountNotice = "";
  let authMode = "login";
  let accountMode = "Balances";
  const CURRENCY_KEY = "demoCurrencySettings";
  const defaultCurrencies = [
    { code: "USD", name: "US Dollar", rate: 1.0000, change: 0.04, visible: true },
    { code: "EUR", name: "Euro", rate: 1.0845, change: 0.12, visible: true },
    { code: "GBP", name: "British Pound", rate: 1.2783, change: 0.09, visible: true },
    { code: "JPY", name: "Japanese Yen", rate: 0.00676, change: -0.06, visible: true },
    { code: "AUD", name: "Australian Dollar", rate: 0.7082, change: -0.08, visible: true },
    { code: "CAD", name: "Canadian Dollar", rate: 0.7424, change: 0.05, visible: true },
    { code: "CHF", name: "Swiss Franc", rate: 1.0940, change: 0.07, visible: true },
    { code: "NZD", name: "New Zealand Dollar", rate: 0.6308, change: -0.04, visible: true },
    { code: "SGD", name: "Singapore Dollar", rate: 0.7395, change: 0.03, visible: true },
    { code: "HKD", name: "Hong Kong Dollar", rate: 0.1278, change: 0.01, visible: true },
    { code: "CNY", name: "Chinese Yuan", rate: 0.1382, change: -0.03, visible: true },
    { code: "PHP", name: "Philippine Peso", rate: 0.0171, change: 0.06, visible: true }
  ];

  function currencySettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(CURRENCY_KEY) || "[]");
      if (Array.isArray(stored) && stored.length) return stored;
    } catch {}
    return defaultCurrencies;
  }

  function priceMap() {
    return Object.fromEntries(currencySettings().map((item) => [item.code, Number(item.rate) || 1]));
  }

  function visibleCurrencies() {
    return currencySettings().filter((item) => item.visible !== false);
  }

  function currencyOptions(selected = "") {
    return visibleCurrencies()
      .map((currency) => `<option value="${currency.code}" ${currency.code === selected ? "selected" : ""}>${currency.code} - ${currency.name}</option>`)
      .join("");
  }

  function fluctuationSeed(code, offset = 0) {
    const now = Math.floor(Date.now() / 45000) + offset;
    const codeValue = code.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return Math.sin(now * 0.83 + codeValue * 1.37);
  }

  function floatingRate(currency, offset = 0) {
    const base = Number(currency.rate) || 1;
    const move = fluctuationSeed(currency.code, offset) * 0.0018;
    return base * (1 + move);
  }

  function floatingChange(currency, offset = 0) {
    const base = Number(currency.change) || 0;
    return base + fluctuationSeed(currency.code, offset + 7) * 0.18;
  }


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
      accountNotice = "";
      cacheServerUser(data.user);
    } catch (error) {
      if ((error.message || "").toLowerCase().includes("frozen")) {
        const username = currentUsername();
        const users = readUsers();
        if (users[username]) {
          users[username].status = "Frozen";
          writeUsers(users);
        }
        accountNotice = "Your account is frozen. Please contact support.";
      }
    }
  }

  async function syncCurrencies() {
    try {
      const data = await apiRequest("currencies");
      if (Array.isArray(data.currencies) && data.currencies.length) {
        localStorage.setItem(CURRENCY_KEY, JSON.stringify(data.currencies));
      }
    } catch {
      // Static fallback currencies keep the interface usable before MySQL is configured.
    }
  }

  function ensureActiveAccount(user) {
    if (user?.status === "Frozen") {
      throw new Error("Your account is frozen. Please contact support.");
    }
  }

  async function migrateLocalUsersToMysql() {
    const users = Object.values(readUsers()).filter((user) => user?.username && user?.password);
    if (!users.length || localStorage.getItem("mysqlUserMigrationDone") === "true") return;
    try {
      await apiRequest("sync_local_users", { users });
      localStorage.setItem("mysqlUserMigrationDone", "true");
    } catch {
      // Migration will retry on the next page load.
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

    user.balances = { ...Object.fromEntries(defaultCurrencies.map((currency) => [currency.code, 0])), ...(user.balances || {}) };
    const oldCreditIndex = user.transactions?.findIndex((tx) => tx.type === "Demo Credit" && tx.detail === "Starting demo balance") ?? -1;
    if (oldCreditIndex >= 0) {
      user.transactions.splice(oldCreditIndex, 1);
      user.balances.USD = Math.max(0, Number(user.balances.USD || 0) - 10000);
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
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
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
    const prices = priceMap();
    return Object.entries(user.balances).reduce((total, [asset, amount]) => {
      return total + amount * (prices[asset] || 1);
    }, 0);
  }

  async function createUser(username, phone, password) {
    if (!/^\d+$/.test(phone)) throw new Error("Phone number must contain numbers only.");

    try {
      const data = await apiRequest("register", { username, phone, password });
      cacheServerUser(data.user);
      return;
    } catch (error) {
      if (backendUnavailable(error)) throw new Error("Cannot connect to MySQL. Please check the server connection.");
      throw error;
    }
  }

  async function login(username, password) {
    try {
      const data = await apiRequest("login", { username, password });
      cacheServerUser(data.user);
      addUserLog(username, "Login", "Success");
      return;
    } catch (error) {
      addUserLog(username, "Login", "Failed");
      if (backendUnavailable(error)) throw new Error("Cannot connect to MySQL. Please check the server connection.");
      throw error;
    }
  }

  function logout() {
    apiRequest("logout").catch(() => {});
    localStorage.removeItem(SESSION_KEY);
  }

  function resetDemo() {
    const user = getUser();
    if (!user) return;
    user.balances = Object.fromEntries(defaultCurrencies.map((currency) => [currency.code, 0]));
    user.transactions = [];
    saveUser(user);
  }

  async function accountAction(type, amount, asset = "USD") {
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    ensureActiveAccount(user);
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("Enter a valid amount.");

    try {
      const data = await apiRequest("account_action", { type, amount: value, asset });
      cacheServerUser(data.user);
      return;
    } catch (error) {
      if (backendUnavailable(error)) throw new Error("Cannot connect to MySQL. Transaction was not saved.");
      throw error;
    }
  }

  async function exchange(fromAsset, toAsset, amount) {
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    ensureActiveAccount(user);
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("Enter a valid amount.");
    if ((user.balances[fromAsset] || 0) < value) throw new Error("Insufficient balance.");

    try {
      const data = await apiRequest("exchange", { fromAsset, toAsset, amount: value });
      cacheServerUser(data.user);
      return;
    } catch (error) {
      if (backendUnavailable(error)) throw new Error("Cannot connect to MySQL. Exchange was not saved.");
      throw error;
    }
  }

  function exchangeEstimate(fromAsset, toAsset, amount) {
    const rates = priceMap();
    const value = Number(amount || 0);
    if (!fromAsset || !toAsset || fromAsset === toAsset || !value || value <= 0) return 0;
    return (value * (rates[fromAsset] || 1)) / (rates[toAsset] || 1);
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
          <span>${user.status === "Frozen" ? "Account frozen" : "Currency account"}</span>
        </div>
        <button type="button" class="demo-close" aria-label="Close">x</button>
      </div>
      <div class="demo-copy">
        <strong>${user.username}</strong>
        <span>Portfolio: ${money(portfolioValue(user))} USD</span>
      </div>
      <div class="demo-balances">
        <span>USD ${money(user.balances.USD)}</span>
        <span>EUR ${coin(user.balances.EUR)}</span>
        <span>JPY ${coin(user.balances.JPY)}</span>
      </div>
      <div class="demo-actions">
        <button type="button" id="logoutDemo">Logout</button>
      </div>
      <div class="demo-message">${message || accountNotice || (user.status === "Frozen" ? "Your account is frozen. Please contact support." : "")}</div>
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

  function bindUserTabs() {
    const tabGroups = [
      ".market-selection",
      ".market-toggle"
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
            if (button.closest(".market-selection") || button.closest(".market-toggle")) {
              filterMarketRows();
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

  function enhanceAccountPage() {
    const header = document.querySelector(".account-header");
    if (!header) return;

    document.querySelectorAll(".account-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        accountMode = tab.textContent.trim();
        document.querySelectorAll(".account-tab").forEach((item) => {
          item.classList.toggle("active", item === tab);
        });
        renderAccount();
      });
    });

    const panel = document.querySelector(".account-panel");
    const controls = document.querySelector(".account-controls");
    controls?.insertAdjacentHTML("afterend", '<section class="account-assets" id="accountAssets"></section>');
    panel?.insertAdjacentHTML("beforeend", `
      <section class="account-ledger">
        <div class="ledger-header">
          <strong>Transaction History</strong>
          <span>Currency records</span>
        </div>
        <div id="accountTransactions"></div>
      </section>
    `);

    document.querySelectorAll(".account-action").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.textContent.trim();
        try {
          if (action.includes("Withdraw")) {
            await accountAction("Withdraw", prompt("Withdrawal amount", "100"), "USD");
          } else if (action.includes("Deposit")) {
            await accountAction("Deposit", prompt("Deposit amount", "500"), "USD");
          } else if (action.includes("Transfer")) {
            await accountAction("Transfer", prompt("Transfer amount", "100"), "USD");
          } else if (action.includes("Exchange")) {
            document.getElementById("exchangeAmount")?.focus();
            renderExchangeQuote();
            return;
          }
          refresh(`${action} transaction recorded.`);
        } catch (error) {
          refresh(error.message);
        }
      });
    });

    document.querySelector(".checkbox-row input")?.addEventListener("change", renderAccount);
    document.querySelector(".search-row input")?.addEventListener("input", renderAccount);
    document.getElementById("exchangeFrom")?.addEventListener("change", renderExchangeQuote);
    document.getElementById("exchangeTo")?.addEventListener("change", renderExchangeQuote);
    document.getElementById("exchangeAmount")?.addEventListener("input", renderExchangeQuote);
    document.getElementById("exchangeSubmit")?.addEventListener("click", submitExchange);

    renderAccount();
  }

  function renderExchangeControls() {
    const fromSelect = document.getElementById("exchangeFrom");
    const toSelect = document.getElementById("exchangeTo");
    if (!fromSelect || !toSelect) return;
    const fromValue = fromSelect.value || "USD";
    const toValue = toSelect.value || "EUR";
    fromSelect.innerHTML = currencyOptions(fromValue);
    toSelect.innerHTML = currencyOptions(toValue === fromValue ? "EUR" : toValue);
    if (fromSelect.value === toSelect.value) {
      toSelect.value = visibleCurrencies().find((currency) => currency.code !== fromSelect.value)?.code || "";
    }
    renderExchangeQuote();
  }

  function renderExchangeQuote() {
    const quote = document.getElementById("exchangeQuote");
    const fromSelect = document.getElementById("exchangeFrom");
    const toSelect = document.getElementById("exchangeTo");
    const amountInput = document.getElementById("exchangeAmount");
    if (!quote || !fromSelect || !toSelect || !amountInput) return;
    const from = fromSelect.value;
    const to = toSelect.value;
    const amount = Number(amountInput.value || 0);
    const estimate = exchangeEstimate(from, to, amount);
    const rate = exchangeEstimate(from, to, 1);
    quote.textContent = from === to
      ? "Choose two different currencies."
      : `Rate 1 ${from} = ${coin(rate)} ${to} - Estimated receive ${coin(estimate)} ${to}`;
  }

  async function submitExchange() {
    const from = document.getElementById("exchangeFrom")?.value;
    const to = document.getElementById("exchangeTo")?.value;
    const amount = document.getElementById("exchangeAmount")?.value;
    try {
      if (!from || !to || from === to) throw new Error("Choose two different currencies.");
      await exchange(from, to, amount);
      document.getElementById("exchangeAmount").value = "";
      refresh("Exchange completed.");
    } catch (error) {
      refresh(error.message);
    }
  }

  function applyAccountStyles() {
    const panel = document.querySelector(".account-panel");
    if (!panel) return;

    Object.assign(panel.style, {
      display: "grid",
      gap: "18px",
      padding: "18px",
      borderRadius: "24px"
    });

    document.querySelectorAll(".account-tabs").forEach((tabs) => {
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

    document.querySelectorAll(".account-tab").forEach((tab) => {
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

    document.querySelectorAll(".account-status").forEach((status) => {
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

    document.querySelectorAll(".account-controls").forEach((controls) => {
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

    document.querySelectorAll(".account-assets, #accountTransactions").forEach((list) => {
      Object.assign(list.style, {
        display: "grid",
        gap: "10px"
      });
    });

    document.querySelectorAll(".asset-row, #accountTransactions .transaction-row").forEach((row) => {
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
      document.querySelectorAll(".account-controls, .exchange-grid, .asset-row, #accountTransactions .transaction-row").forEach((node) => {
        node.style.gridTemplateColumns = "1fr";
      });
    }
  }

  function renderAccount() {
    const user = getUser();
    const value = portfolioValue(user);
    document.querySelectorAll(".account-amount, .account-summary-value").forEach((node) => {
      node.textContent = money(value);
    });
    document.querySelectorAll(".account-usd, .account-summary-usd").forEach((node) => {
      node.textContent = `approx $${money(value)}`;
    });
    const status = document.querySelector(".account-status-message");
    if (status) status.textContent = user
      ? (user.status === "Frozen" ? "Your account is frozen. Please contact support." : `${accountMode} view active.`)
      : "Please register or log in to use the currency account.";
    const ledgerLabel = document.querySelector(".ledger-header span");
    if (ledgerLabel) ledgerLabel.textContent = `${accountMode} records`;
    const ledger = document.getElementById("accountTransactions");
    if (ledger) ledger.innerHTML = transactionRows(user);
    const assets = document.getElementById("accountAssets");
    if (assets) {
      const query = document.querySelector(".search-row input")?.value.trim().toLowerCase() || "";
      const hideSmall = document.querySelector(".checkbox-row input")?.checked;
      const balances = user?.balances || Object.fromEntries(defaultCurrencies.map((currency) => [currency.code, 0]));
      const rows = Object.entries(balances)
        .filter(([asset, amount]) => (!query || asset.toLowerCase().includes(query)) && (!hideSmall || Number(amount) > 0))
        .map(([asset, amount]) => {
          const currency = currencySettings().find((item) => item.code === asset);
          const value = amount * (priceMap()[asset] || 1);
          return `
            <div class="asset-row">
              <div>
                <strong>${asset}</strong>
                <span>${currency?.name || "Currency balance"}</span>
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
    renderExchangeControls();
    applyAccountStyles();
  }

  function formatRate(value) {
    const numeric = Number(value) || 0;
    if (numeric >= 100) return numeric.toFixed(2);
    if (numeric >= 1) return numeric.toFixed(4);
    return numeric.toFixed(5);
  }

  function renderRateCards() {
    const grid = document.querySelector(".rates-grid");
    if (!grid) return;
    grid.innerHTML = visibleCurrencies().slice(0, 6).map((currency, index) => {
      const change = floatingChange(currency, index);
      return `
        <article class="rate-card">
          <div class="rate-label">${currency.code}</div>
          <div class="rate-value">${formatRate(floatingRate(currency, index))}</div>
          <div class="rate-sub">${currency.name}</div>
          <div class="rate-change ${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</div>
        </article>
      `;
    }).join("");
  }

  function renderMarketRows() {
    document.querySelectorAll(".market-list-card").forEach((card) => {
      const header = card.querySelector(".market-list-header")?.outerHTML || '<div class="market-list-header"><span>Pair</span><span>Last Price</span><span>Change</span></div>';
      const rows = visibleCurrencies()
        .filter((currency) => currency.code !== "USD")
        .map((currency, index) => {
          const change = floatingChange(currency, index);
          const volume = (Math.abs(fluctuationSeed(currency.code, index)) * 900000 + 12000).toLocaleString(undefined, { maximumFractionDigits: 3 });
          return `
            <div class="market-row">
              <div class="market-pair"><span class="pair-icon" aria-hidden="true">&#128181;</span><div><div class="pair-name">${currency.code}/USD</div><div class="pair-sub">VOL ${volume}</div></div></div>
              <div class="market-price">${formatRate(floatingRate(currency, index))}</div>
              <div class="market-change ${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</div>
            </div>
          `;
        }).join("");
      card.innerHTML = header + rows;
    });
    filterMarketRows();
  }

  function renderDynamicMarkets() {
    renderRateCards();
    renderMarketRows();
  }

  function refresh(message = "") {
    drawAccountPanel(message);
    renderAccount();
    renderDynamicMarkets();
  }

  async function init() {
    await syncCurrencies();
    await migrateLocalUsersToMysql();
    await syncCurrentUser();
    renderAccountPanel();
    bindAccountButtons();
    bindUserTabs();
    bindMarketSearch();
    enhanceAccountPage();
    renderDynamicMarkets();
    setInterval(renderDynamicMarkets, 45000);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", DemoExchange.init);

