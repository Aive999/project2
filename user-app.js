const DemoExchange = (() => {
  const USERS_KEY = "demoExchangeUsers";
  const SESSION_KEY = "demoExchangeSession";
  const USER_LOG_KEY = "userLoginLog";
  const API_URL = "api/index.php";
  let accountNotice = "";
  let authMode = "login";
  let accountMode = "Balances";
  const CURRENCY_KEY = "demoCurrencySettings";
  const FLUCTUATION_INTERVAL_MS = 12000;
  const currentRateMap = {
    USD: 1.0000,
    EUR: 1.14760,
    GBP: 1.32321,
    JPY: 0.00619959,
    AUD: 0.701083,
    CAD: 0.70608,
    CHF: 1.23903
  };
  const defaultCurrencies = [
    { code: "USD", name: "US Dollar", rate: currentRateMap.USD, change: 0.04, visible: true },
    { code: "EUR", name: "Euro", rate: currentRateMap.EUR, change: 0.12, visible: true },
    { code: "GBP", name: "British Pound", rate: currentRateMap.GBP, change: 0.09, visible: true },
    { code: "JPY", name: "Japanese Yen", rate: currentRateMap.JPY, change: -0.06, visible: true },
    { code: "AUD", name: "Australian Dollar", rate: currentRateMap.AUD, change: -0.08, visible: true },
    { code: "CAD", name: "Canadian Dollar", rate: currentRateMap.CAD, change: 0.05, visible: true },
    { code: "CHF", name: "Swiss Franc", rate: currentRateMap.CHF, change: 0.07, visible: true },
    { code: "NZD", name: "New Zealand Dollar", rate: 0.6308, change: -0.04, visible: true },
    { code: "SGD", name: "Singapore Dollar", rate: 0.7395, change: 0.03, visible: true },
    { code: "HKD", name: "Hong Kong Dollar", rate: 0.1278, change: 0.01, visible: true },
    { code: "CNY", name: "Chinese Yuan Renminbi", rate: 0.1382, change: -0.03, visible: true },
    { code: "PHP", name: "Philippine Peso", rate: 0.0171, change: 0.06, visible: true }
  ];
  const marketCurrencyRows = [
    { code: "USD", label: "US Dollar", flag: "US" },
    { code: "EUR", label: "Euro", flag: "EU" },
    { code: "GBP", label: "British Pound", flag: "GB" },
    { code: "JPY", label: "Japanese Yen", flag: "JP" },
    { code: "CAD", label: "Canadian Dollar", flag: "CA" },
    { code: "AUD", label: "Australian Dollar", flag: "AU" },
    { code: "CHF", label: "Swiss Franc", flag: "CH" },
    { code: "CNY", label: "Chinese Yuan Renminbi", flag: "CN" },
    { code: "PHP", label: "Philippine Peso", flag: "PH" }
  ];
  const supportedAssets = new Set(defaultCurrencies.map((currency) => currency.code));

  function emptyBalances() {
    return Object.fromEntries(defaultCurrencies.map((currency) => [currency.code, 0]));
  }

  function normalizeBalances(balances = {}) {
    const normalized = emptyBalances();
    Object.entries(balances || {}).forEach(([asset, amount]) => {
      const code = String(asset || "").toUpperCase();
      if (supportedAssets.has(code)) {
        normalized[code] = Number(amount) || 0;
      }
    });
    return normalized;
  }

  function normalizeUser(user) {
    if (!user) return user;
    return {
      ...user,
      balances: normalizeBalances(user.balances),
      transactions: Array.isArray(user.transactions) ? user.transactions : []
    };
  }

  function currencySettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(CURRENCY_KEY) || "[]");
      if (Array.isArray(stored) && stored.length) {
        return stored.map((currency) => ({
          ...currency,
          rate: currentRateMap[currency.code] ?? currency.rate,
          name: currency.code === "CNY" ? "Chinese Yuan Renminbi" : currency.name
        }));
      }
    } catch {}
    return defaultCurrencies;
  }

  function currencyByCode(code) {
    return currencySettings().find((currency) => currency.code === code)
      || defaultCurrencies.find((currency) => currency.code === code)
      || { code, rate: 1, change: 0, visible: true };
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

  function fluctuationSeed(code, offset = 0, tickShift = 0) {
    const now = Math.floor(Date.now() / FLUCTUATION_INTERVAL_MS) + offset + tickShift;
    const codeValue = code.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return Math.sin(now * 0.83 + codeValue * 1.37);
  }

  function floatingRate(currency, offset = 0, tickShift = 0) {
    const base = Number(currency.rate) || 1;
    const move = fluctuationSeed(currency.code, offset, tickShift) * 0.0018;
    return base * (1 + move);
  }

  function tickMovement(currency, offset = 0) {
    const current = floatingRate(currency, offset);
    const previous = floatingRate(currency, offset, -1);
    const percent = previous ? ((current - previous) / previous) * 100 : 0;
    return { current, percent };
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
    users[user.username] = normalizeUser(user);
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
          users[username] = normalizeUser({ ...users[username], status: "Frozen" });
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

    user.balances = normalizeBalances(user.balances);
    user.transactions = Array.isArray(user.transactions) ? user.transactions : [];
    const oldCreditIndex = user.transactions?.findIndex((tx) => tx.type === "Demo Credit" && tx.detail === "Starting demo balance") ?? -1;
    if (oldCreditIndex >= 0) {
      user.transactions.splice(oldCreditIndex, 1);
      user.balances.USD = Math.max(0, Number(user.balances.USD || 0) - 10000);
    }
    users[username] = normalizeUser(user);
    writeUsers(users);

    return user;
  }

  function saveUser(user) {
    const users = readUsers();
    users[user.username] = normalizeUser(user);
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
    return Object.entries(normalizeBalances(user.balances)).reduce((total, [asset, amount]) => {
      return total + amount * (prices[asset] || 1);
    }, 0);
  }

  async function createUser(username, phone, password) {
    if (!/^\d+$/.test(phone)) throw new Error("Phone number must contain numbers only.");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new Error("Password must be at least 8 characters and include letters and numbers.");
    }

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

  function readVerificationImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("Select an identity document image."));
        return;
      }
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        reject(new Error("Upload a PNG, JPG, or WEBP image."));
        return;
      }
      if (file.size > 700 * 1024) {
        reject(new Error("Image must be under 700 KB."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read selected image."));
      reader.readAsDataURL(file);
    });
  }

  async function submitIdentityVerification(documentType, idNumber, frontFile, backFile) {
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    ensureActiveAccount(user);
    const cleanId = String(idNumber || "").trim();
    if (!cleanId) throw new Error("Enter your ID number.");
    const frontImage = await readVerificationImage(frontFile);
    const backImage = await readVerificationImage(backFile);
    const data = await apiRequest("submit_identity_verification", {
      documentType,
      idNumber: cleanId,
      frontImage,
      backImage
    });
    cacheServerUser(data.user);
  }

  function verificationStatusText(verification) {
    if (!verification) return "Not submitted";
    if (verification.status === "Approved") return "Verified";
    if (verification.status === "Rejected") return "Rejected";
    return "Pending review";
  }

  function verificationImagePreview(verification) {
    if (!verification?.frontImage && !verification?.backImage) return "";
    return `
      <div class="identity-preview-grid">
        ${verification.frontImage ? `
          <a class="identity-preview" href="${verification.frontImage}" target="_blank" rel="noopener">
            <img src="${verification.frontImage}" alt="Submitted ID front photo">
            <span>Front photo</span>
          </a>
        ` : ""}
        ${verification.backImage ? `
          <a class="identity-preview" href="${verification.backImage}" target="_blank" rel="noopener">
            <img src="${verification.backImage}" alt="Submitted ID back photo">
            <span>Back photo</span>
          </a>
        ` : ""}
      </div>
    `;
  }

  function logout() {
    apiRequest("logout").catch(() => {});
    localStorage.removeItem(SESSION_KEY);
  }

  function showPublicToast(message, type = "success") {
    let toast = document.querySelector(".public-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "public-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `public-toast ${type} show`;
    clearTimeout(showPublicToast.timer);
    showPublicToast.timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 4200);
  }

  function resetDemo() {
    const user = getUser();
    if (!user) return;
    user.balances = emptyBalances();
    user.transactions = [];
    saveUser(user);
  }

  async function accountAction(type, amount, asset = "USD", extra = {}) {
    await syncCurrentUser();
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    ensureActiveAccount(user);
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("Enter a valid amount.");

    try {
      const data = await apiRequest("account_action", { type, amount: value, asset, ...extra });
      cacheServerUser(data.user);
      return;
    } catch (error) {
      if (backendUnavailable(error)) throw new Error("Cannot connect to MySQL. Transaction was not saved.");
      throw error;
    }
  }

  async function exchange(fromAsset, toAsset, amount) {
    await syncCurrentUser();
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    ensureActiveAccount(user);
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("Enter a valid amount.");

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

  function tradingPairs() {
    const preferred = [
      ["EUR", "USD"],
      ["GBP", "EUR"],
      ["USD", "JPY"],
      ["GBP", "USD"],
      ["USD", "CHF"],
      ["USD", "CAD"],
      ["EUR", "JPY"],
      ["AUD", "USD"],
      ["NZD", "USD"],
      ["CAD", "JPY"],
      ["USD", "PHP"],
      ["CNY", "USD"]
    ];
    const visible = new Set(visibleCurrencies().map((currency) => currency.code));
    return preferred.filter(([base, quote]) => visible.has(base) && visible.has(quote));
  }

  function pairPrice(base, quote) {
    const rates = priceMap();
    return (rates[base] || 1) / (rates[quote] || 1);
  }

  function pairMovement(base, quote, offset = 0) {
    const baseCurrency = currencyByCode(base);
    const quoteCurrency = currencyByCode(quote);
    const current = floatingRate(baseCurrency, offset) / floatingRate(quoteCurrency, offset + 3);
    const previous = floatingRate(baseCurrency, offset, -1) / floatingRate(quoteCurrency, offset + 3, -1);
    const percent = previous ? ((current - previous) / previous) * 100 : 0;
    return { current, percent };
  }

  function tradeChartPaths(base, quote) {
    const basePrice = pairPrice(base, quote);
    const values = Array.from({ length: 34 }, (_, index) => {
      const wave = fluctuationSeed(base + quote, index / 4);
      const pulse = Math.sin((Date.now() / FLUCTUATION_INTERVAL_MS + index) * 0.62) * 0.0035;
      const drift = (index - 16) * 0.00008;
      return basePrice * (1 + wave * 0.006 + pulse + drift);
    });
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const points = values.map((value, index) => {
      const x = index * (900 / (values.length - 1));
      const y = 250 - ((value - min) / span) * 190;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    return {
      line: points,
      area: `${points} L900 300 L0 300 Z`,
      positive: values[values.length - 1] >= values[0]
    };
  }

  function tradeEstimate(base, quote, amount) {
    const value = Number(amount || 0);
    if (!base || !quote || base === quote || !value || value <= 0) return 0;
    return value * pairMovement(base, quote).current;
  }

  async function tradeOrder(baseAsset, quoteAsset, side, amount) {
    await syncCurrentUser();
    const user = getUser();
    if (!user) throw new Error("Please register or log in first.");
    ensureActiveAccount(user);
    const value = Number(amount);
    if (!value || value <= 0) throw new Error("Enter a valid order amount.");
    const price = pairMovement(baseAsset, quoteAsset).current;
    const quoteAmount = value * price;

    try {
      const data = await apiRequest("trade_order", { baseAsset, quoteAsset, side, amount: value });
      cacheServerUser(data.user);
      return data;
    } catch (error) {
      if (!backendUnavailable(error)) throw error;
      if (side === "Buy" && (user.balances[quoteAsset] || 0) < quoteAmount) {
        throw new Error(`Insufficient ${quoteAsset} balance. Need ${coin(quoteAmount)} ${quoteAsset}.`);
      }
      if (side === "Sell" && (user.balances[baseAsset] || 0) < value) {
        throw new Error(`Insufficient ${baseAsset} balance. Need ${coin(value)} ${baseAsset}.`);
      }
      if (side === "Buy") {
        user.balances[quoteAsset] -= quoteAmount;
        user.balances[baseAsset] = (user.balances[baseAsset] || 0) + value;
      } else {
        user.balances[baseAsset] -= value;
        user.balances[quoteAsset] = (user.balances[quoteAsset] || 0) + quoteAmount;
      }
      addTransaction(user, `Trade ${side}`, `${baseAsset}/${quoteAsset}`, value, "Filled", `${side === "Buy" ? "Bought" : "Sold"} ${coin(value)} ${baseAsset} at ${formatRate(price)} ${quoteAsset}`);
      return { ok: true, price, quoteAmount, offline: true };
    }
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
      <section class="user-settings-card">
        <div class="settings-card-top">
          <strong>User settings</strong>
          <span>Account profile</span>
        </div>
        <div class="settings-list">
          <div><span>Username</span><strong>${user.username}</strong></div>
          <div><span>Phone</span><strong>${user.phone || "-"}</strong></div>
          <div><span>Account status</span><strong>${user.status || "Active"}</strong></div>
          <div><span>Verification</span><strong>${verificationStatusText(user.verification)}</strong></div>
        </div>
      </section>
      <section class="identity-card">
        <div class="identity-card-top">
          <div>
            <strong>Profile verification</strong>
            <span>${verificationStatusText(user.verification)}</span>
          </div>
          <span class="identity-status identity-${(user.verification?.status || "none").toLowerCase()}">${verificationStatusText(user.verification)}</span>
        </div>
        ${user.verification?.status === "Approved" ? `
          <div class="identity-approved">
            ${user.verification.documentType} verified on ${user.verification.reviewedAt || user.verification.submittedAt || "record"}.
          </div>
          ${verificationImagePreview(user.verification)}
        ` : `
          <form class="identity-form" id="identityForm">
            <label>
              <span>File type</span>
              <select id="identityDocumentType" required>
                <option value="ID Card">ID Card</option>
                <option value="Passport">Passport</option>
                <option value="Driver License">Driver License</option>
              </select>
            </label>
            <label>
              <span>ID number</span>
              <input id="identityNumber" type="text" autocomplete="off" placeholder="Enter document number" required>
            </label>
            <label class="identity-upload">
              <span>ID front photo</span>
              <input id="identityFrontImage" type="file" accept="image/png,image/jpeg,image/webp" required>
            </label>
            <label class="identity-upload">
              <span>ID back photo</span>
              <input id="identityBackImage" type="file" accept="image/png,image/jpeg,image/webp" required>
            </label>
            <div class="identity-preview-grid" id="identitySelectedPreviews" hidden>
              <div class="identity-preview" id="frontImagePreview" hidden>
                <img alt="Selected ID front photo">
                <span>Front photo</span>
              </div>
              <div class="identity-preview" id="backImagePreview" hidden>
                <img alt="Selected ID back photo">
                <span>Back photo</span>
              </div>
            </div>
            <button type="submit">Submit verification</button>
          </form>
          ${verificationImagePreview(user.verification)}
          ${user.verification?.status === "Rejected" ? `<div class="identity-review-note">${user.verification.reviewNote || "Please check your document and submit again."}</div>` : ""}
        `}
      </section>
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
    bindIdentityForm();
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

  function renderWithdrawalPanel() {
    if (document.querySelector(".withdrawal-modal")) return;
    const modal = document.createElement("div");
    modal.className = "withdrawal-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="withdrawal-panel" role="dialog" aria-modal="true" aria-label="Link receiving account">
        <div class="withdrawal-panel-top">
          <div>
            <strong>Receiving account</strong>
            <span>Link where your withdrawal should be sent.</span>
          </div>
          <button type="button" class="withdrawal-close" aria-label="Close">x</button>
        </div>
        <form id="withdrawalForm" class="withdrawal-form">
          <label>
            <span>Amount (USD)</span>
            <input id="withdrawAmount" type="number" min="0" step="0.01" placeholder="100.00" inputmode="decimal" required>
          </label>
          <label>
            <span>Bank</span>
            <input id="withdrawBank" type="text" placeholder="beneficiary_bank" autocomplete="organization" required>
          </label>
          <label>
            <span>Name</span>
            <input id="withdrawName" type="text" placeholder="account_name" autocomplete="name" required>
          </label>
          <label>
            <span>Collection account</span>
            <input id="withdrawAccount" type="text" placeholder="collection_account" autocomplete="off" required>
          </label>
          <label>
            <span>Routing</span>
            <input id="withdrawRouting" type="text" placeholder="aba_routing_number" autocomplete="off" required>
          </label>
          <label>
            <span>Address</span>
            <input id="withdrawAddress" type="text" placeholder="company_personal_address" autocomplete="street-address" required>
          </label>
          <button type="submit">Submit</button>
        </form>
        <div class="withdrawal-message" id="withdrawalMessage"></div>
      </section>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeWithdrawalPanel();
    });
    modal.querySelector(".withdrawal-close")?.addEventListener("click", closeWithdrawalPanel);
    modal.querySelector("#withdrawalForm")?.addEventListener("submit", submitWithdrawalForm);
  }

  function openWithdrawalPanel() {
    const user = getUser();
    if (!user) {
      openAccountPanel();
      drawAccountPanel("Please register or log in first.");
      return;
    }
    try {
      ensureActiveAccount(user);
    } catch (error) {
      refresh(error.message);
      return;
    }
    renderWithdrawalPanel();
    const modal = document.querySelector(".withdrawal-modal");
    if (!modal) return;
    const message = document.getElementById("withdrawalMessage");
    if (message) {
      message.textContent = "";
      message.className = "withdrawal-message";
    }
    modal.hidden = false;
    modal.classList.add("open");
    document.body.classList.add("withdrawal-modal-open");
  }

  function closeWithdrawalPanel() {
    const modal = document.querySelector(".withdrawal-modal");
    if (modal) {
      modal.classList.remove("open");
      modal.hidden = true;
    }
    document.body.classList.remove("withdrawal-modal-open");
  }

  function renderDepositPanel() {
    if (document.querySelector(".deposit-modal")) return;
    const modal = document.createElement("div");
    modal.className = "deposit-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="deposit-panel" role="dialog" aria-modal="true" aria-label="Deposit funds">
        <div class="deposit-panel-top">
          <div>
            <strong>Deposit funds</strong>
            <span>Submit your deposit details for account credit.</span>
          </div>
          <button type="button" class="deposit-close" aria-label="Close">x</button>
        </div>
        <form id="depositForm" class="deposit-form">
          <label>
            <span>Amount (USD)</span>
            <input id="depositAmount" type="number" min="0" step="0.01" placeholder="500.00" inputmode="decimal" required>
          </label>
          <label>
            <span>Payment method</span>
            <select id="depositMethod" required>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Card">Card</option>
              <option value="Crypto Transfer">Crypto Transfer</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>
            <span>Sender name</span>
            <input id="depositSender" type="text" placeholder="sender_name" autocomplete="name" required>
          </label>
          <label>
            <span>Reference number</span>
            <input id="depositReference" type="text" placeholder="transaction_reference" autocomplete="off" required>
          </label>
          <button type="submit">Submit</button>
        </form>
        <div class="deposit-message" id="depositMessage"></div>
      </section>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeDepositPanel();
    });
    modal.querySelector(".deposit-close")?.addEventListener("click", closeDepositPanel);
    modal.querySelector("#depositForm")?.addEventListener("submit", submitDepositForm);
  }

  function openDepositPanel() {
    const user = getUser();
    if (!user) {
      openAccountPanel();
      drawAccountPanel("Please register or log in first.");
      return;
    }
    try {
      ensureActiveAccount(user);
    } catch (error) {
      refresh(error.message);
      return;
    }
    renderDepositPanel();
    const modal = document.querySelector(".deposit-modal");
    if (!modal) return;
    const message = document.getElementById("depositMessage");
    if (message) {
      message.textContent = "";
      message.className = "deposit-message";
    }
    modal.hidden = false;
    modal.classList.add("open");
    document.body.classList.add("deposit-modal-open");
  }

  function closeDepositPanel() {
    const modal = document.querySelector(".deposit-modal");
    if (modal) {
      modal.classList.remove("open");
      modal.hidden = true;
    }
    document.body.classList.remove("deposit-modal-open");
  }

  async function submitDepositForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const message = document.getElementById("depositMessage");
    const method = document.getElementById("depositMethod").value;
    const sender = document.getElementById("depositSender").value.trim();
    const reference = document.getElementById("depositReference").value.trim();
    try {
      if (!sender || !reference) throw new Error("Complete all deposit fields.");
      if (button) {
        button.disabled = true;
        button.textContent = "Submitting...";
      }
      if (message) {
        message.textContent = "Submitting deposit request...";
        message.className = "deposit-message";
      }
      showPublicToast("Submitting deposit request...", "info");
      await accountAction("Deposit", document.getElementById("depositAmount").value, "USD", {
        depositDetails: { method, sender, reference }
      });
      if (message) {
        message.textContent = "Deposit submitted successfully.";
        message.className = "deposit-message success";
      }
      showPublicToast("Deposit submitted successfully.", "success");
      form.reset();
      setTimeout(() => {
        closeDepositPanel();
        refresh("Deposit submitted successfully.");
      }, 700);
    } catch (error) {
      showPublicToast(`Deposit failed: ${error.message}`, "error");
      if (message) {
        message.textContent = `Deposit failed: ${error.message}`;
        message.className = "deposit-message error";
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Submit";
      }
    }
  }

  async function submitWithdrawalForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const message = document.getElementById("withdrawalMessage");
    const details = {
      bank: document.getElementById("withdrawBank").value.trim(),
      name: document.getElementById("withdrawName").value.trim(),
      collectionAccount: document.getElementById("withdrawAccount").value.trim(),
      routing: document.getElementById("withdrawRouting").value.trim(),
      address: document.getElementById("withdrawAddress").value.trim()
    };
    try {
      if (Object.values(details).some((value) => !value)) {
        throw new Error("Complete all receiving account fields.");
      }
      if (button) {
        button.disabled = true;
        button.textContent = "Submitting...";
      }
      if (message) {
        message.textContent = "Submitting withdrawal request...";
        message.className = "withdrawal-message";
      }
      showPublicToast("Submitting withdrawal request...", "info");
      await accountAction("Withdraw", document.getElementById("withdrawAmount").value, "USD", {
        withdrawDetails: details
      });
      if (message) {
        message.textContent = "Withdrawal submitted successfully.";
        message.className = "withdrawal-message success";
      }
      showPublicToast("Withdrawal submitted successfully. Status: Pending review.", "success");
      form.reset();
      setTimeout(() => {
        closeWithdrawalPanel();
        refresh("Withdrawal submitted successfully. Status: Pending review.");
      }, 700);
    } catch (error) {
      showPublicToast(`Withdrawal failed: ${error.message}`, "error");
      if (message) {
        message.textContent = `Withdrawal failed: ${error.message}`;
        message.className = "withdrawal-message error";
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Submit";
      }
    }
  }

  function bindAccountButtons() {
    document.querySelectorAll('.account-button, .icon-button[aria-label="Support"], .icon-button[aria-label="Login or register"]').forEach((button) => {
      const label = currentUsername() ? "Account settings" : "Login or register";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.addEventListener("click", openAccountPanel);
    });

    document.querySelectorAll(".main-nav a[href$='account.html'], .main-nav a[href*='account.html']").forEach((link) => {
      link.addEventListener("click", (event) => {
        if (getUser()) return;
        event.preventDefault();
        authMode = "login";
        openAccountPanel();
        drawAccountPanel("Please log in or register to view your account.");
      });
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
    document.querySelectorAll(".market-list-card").forEach((card) => {
      const activeFilter = document.querySelector(".market-filter-item.active");
      const showAll = card.classList.contains("currency-rate-list") || !activeFilter || activeFilter.textContent.trim() === "All";
      card.querySelectorAll(".market-row").forEach((row, index) => {
        const pair = row.querySelector(".pair-name")?.textContent.toLowerCase() || "";
        const pairSub = row.querySelector(".pair-sub")?.textContent.toLowerCase() || "";
        const matchesSearch = !query || pair.includes(query) || pairSub.includes(query);
        const matchesFilter = showAll || index < 3;
        row.hidden = !(matchesSearch && matchesFilter);
      });
    });
  }

  function bindIdentityForm() {
    const form = document.getElementById("identityForm");
    const frontInput = document.getElementById("identityFrontImage");
    const backInput = document.getElementById("identityBackImage");
    const bindPreview = (input, previewId) => {
      input?.addEventListener("change", async () => {
        const preview = document.getElementById(previewId);
        const grid = document.getElementById("identitySelectedPreviews");
        const image = preview?.querySelector("img");
        if (!preview || !image || !grid) return;
        try {
          const dataUrl = await readVerificationImage(input.files[0]);
          image.src = dataUrl;
          preview.hidden = false;
          grid.hidden = false;
        } catch (error) {
          input.value = "";
          preview.hidden = true;
          image.removeAttribute("src");
          const anyVisible = Array.from(grid.querySelectorAll(".identity-preview")).some((item) => !item.hidden);
          grid.hidden = !anyVisible;
          drawAccountPanel(error.message);
        }
      });
    };
    bindPreview(frontInput, "frontImagePreview");
    bindPreview(backInput, "backImagePreview");

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button[type='submit']");
      try {
        if (button) {
          button.disabled = true;
          button.textContent = "Submitting...";
        }
        await submitIdentityVerification(
          document.getElementById("identityDocumentType").value,
          document.getElementById("identityNumber").value,
          document.getElementById("identityFrontImage").files[0],
          document.getElementById("identityBackImage").files[0]
        );
        refresh("Verification submitted for admin review.");
      } catch (error) {
        drawAccountPanel(error.message);
      }
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

    const main = document.querySelector("body.account-page main");
    if (main && !document.querySelector(".account-auth-gate")) {
      const gate = document.createElement("section");
      gate.className = "account-auth-gate";
      gate.innerHTML = `
        <div>
          <strong>Account access</strong>
          <span>Log in or create an account to view balances, deposits, withdrawals, and exchange tools.</span>
        </div>
        <div class="account-auth-actions">
          <button type="button" data-auth-entry="login">Login</button>
          <button type="button" data-auth-entry="register">Sign up</button>
        </div>
      `;
      main.insertBefore(gate, document.querySelector(".account-panel"));
      gate.querySelectorAll("[data-auth-entry]").forEach((button) => {
        button.addEventListener("click", () => {
          authMode = button.dataset.authEntry || "login";
          openAccountPanel();
          drawAccountPanel(authMode === "register"
            ? "Create an account to view the account tab."
            : "Please log in to view the account tab.");
        });
      });
    }

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

    document.querySelectorAll(".account-action").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.textContent.trim();
        try {
          if (action.includes("Withdraw")) {
            openWithdrawalPanel();
            return;
          } else if (action.includes("Deposit")) {
            openDepositPanel();
            return;
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

  function renderTradePage(message = "") {
    const ticket = document.querySelector(".trade-ticket");
    if (!ticket) return;
    const pairSelect = document.getElementById("tradePair");
    const amountInput = document.getElementById("tradeAmount");
    const side = document.querySelector(".trade-side.active")?.dataset.side || "Buy";
    const pairs = tradingPairs();
    if (pairSelect && !pairSelect.options.length) {
      pairSelect.innerHTML = pairs.map(([base, quote]) => `<option value="${base}/${quote}">${base}/${quote}</option>`).join("");
    }
    const [base, quote] = (pairSelect?.value || pairs[0]?.join("/") || "EUR/USD").split("/");
    const amount = Number(amountInput?.value || 0);
    const movement = pairMovement(base, quote);
    const price = movement.current;
    const quoteAmount = tradeEstimate(base, quote, amount);
    const user = getUser();

    const selectedPair = document.getElementById("selectedPair");
    const selectedPrice = document.getElementById("selectedPrice");
    const selectedSpread = document.getElementById("selectedSpread");
    const selectedBalance = document.getElementById("selectedBalance");
    const tradeQuote = document.getElementById("tradeQuote");
    const positions = document.getElementById("tradePositions");
    const chartLine = document.querySelector(".trade-chart .chart-line");
    const chartArea = document.querySelector(".trade-chart .chart-area");
    const chart = document.querySelector(".trade-chart");
    const chartPaths = tradeChartPaths(base, quote);

    if (selectedPair) selectedPair.textContent = `${base}/${quote}`;
    if (selectedPrice) selectedPrice.textContent = formatRate(price);
    if (selectedSpread) selectedSpread.textContent = `${formatRate(price * 0.9994)} / ${formatRate(price * 1.0006)}`;
    if (chartLine) chartLine.setAttribute("d", chartPaths.line);
    if (chartArea) chartArea.setAttribute("d", chartPaths.area);
    if (chart) chart.classList.toggle("chart-negative", !chartPaths.positive);
    if (selectedBalance) selectedBalance.textContent = user
      ? `${side === "Buy" ? quote : base} ${coin(user.balances?.[side === "Buy" ? quote : base] || 0)} available`
      : "Login required";
    if (tradeQuote) {
      tradeQuote.textContent = message || (amount > 0
        ? `${side} ${coin(amount)} ${base} - ${side === "Buy" ? "Cost" : "Receive"} ${coin(quoteAmount)} ${quote}`
        : `Price 1 ${base} = ${formatRate(price)} ${quote}`);
    }
    if (positions) {
      const trades = (user?.transactions || []).filter((tx) => tx.type.startsWith("Trade"));
      positions.innerHTML = trades.length ? trades.slice(0, 8).map((tx) => `
        <div class="trade-position-row">
          <div><strong>${tx.type}</strong><span>${tx.asset}</span></div>
          <div><strong>${coin(tx.amount)}</strong><span>${tx.status} - ${tx.time}</span></div>
        </div>
      `).join("") : '<div class="empty-state">No trade orders yet</div>';
    }
  }

  function bindTradingPage() {
    if (!document.querySelector(".trade-ticket")) return;
    renderTradePage();
    document.getElementById("tradePair")?.addEventListener("change", () => renderTradePage());
    document.getElementById("tradeAmount")?.addEventListener("input", () => renderTradePage());
    document.querySelectorAll(".trade-side").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".trade-side").forEach((item) => item.classList.toggle("active", item === button));
        renderTradePage();
      });
    });
    document.getElementById("tradeSubmit")?.addEventListener("click", async () => {
      const [base, quote] = document.getElementById("tradePair").value.split("/");
      const side = document.querySelector(".trade-side.active")?.dataset.side || "Buy";
      const amount = document.getElementById("tradeAmount").value;
      try {
        const result = await tradeOrder(base, quote, side, amount);
        document.getElementById("tradeAmount").value = "";
        await syncCurrentUser();
        renderTradePage(`${side} order filled at ${formatRate(result?.price || pairMovement(base, quote).current)} ${quote}.`);
        renderAccount();
      } catch (error) {
        renderTradePage(error.message);
      }
    });
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

    document.querySelectorAll(".account-assets").forEach((list) => {
      Object.assign(list.style, {
        display: "grid",
        gap: "10px"
      });
    });

    document.querySelectorAll(".asset-row").forEach((row) => {
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
      document.querySelectorAll(".account-controls, .exchange-grid, .asset-row").forEach((node) => {
        node.style.gridTemplateColumns = "1fr";
      });
    }
  }

  function renderAccount() {
    const user = getUser();
    const isAccountPage = document.body.classList.contains("account-page");
    document.body.classList.toggle("account-auth-required", Boolean(isAccountPage && !user));
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
    if (isAccountPage && !user) {
      const assets = document.getElementById("accountAssets");
      if (assets) assets.innerHTML = "";
      applyAccountStyles();
      return;
    }
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

  function formatMarketAmount(value) {
    const numeric = Number(value) || 0;
    if (numeric === 1) return "1";
    if (numeric >= 100) return numeric.toFixed(1);
    if (numeric >= 10) return numeric.toFixed(3);
    if (numeric >= 1) return numeric.toFixed(4);
    return numeric.toFixed(5);
  }

  function sparklinePath(code, index, positive) {
    const points = Array.from({ length: 32 }, (_, pointIndex) => {
      const seed = fluctuationSeed(code, index + pointIndex / 5);
      const pulse = pointIndex > 14 && pointIndex < 24 ? Math.sin(pointIndex * 2.4 + index) * 18 : 0;
      const trend = positive ? -pointIndex * 0.55 : pointIndex * 0.45;
      const y = Math.max(8, Math.min(54, 32 + seed * 4 + pulse + trend));
      const x = pointIndex * (140 / 31);
      return `${pointIndex === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return points.join(" ");
  }

  function renderRateCards() {
    const grid = document.querySelector(".rates-grid");
    if (!grid) return;
    grid.innerHTML = visibleCurrencies().slice(0, 6).map((currency, index) => {
      const movement = tickMovement(currency, index);
      return `
        <article class="rate-card">
          <div class="rate-label">${currency.code}</div>
          <div class="rate-value">${formatRate(movement.current)}</div>
          <div class="rate-sub">${currency.name}</div>
          <div class="rate-change ${movement.percent >= 0 ? "positive" : "negative"}">${movement.percent >= 0 ? "+" : ""}${movement.percent.toFixed(2)}%</div>
        </article>
      `;
    }).join("");
  }

  function renderMarketRows() {
    document.querySelectorAll(".market-list-card").forEach((card) => {
      const isCurrencyRateList = card.classList.contains("currency-rate-list");
      if (isCurrencyRateList) {
        const inverse = document.getElementById("marketInverse")?.checked === true;
        const header = `
          <div class="market-list-header currency-rate-header">
            <label class="inverse-control">Inverse USD <input id="marketInverse" type="checkbox" ${inverse ? "checked" : ""}><i></i></label>
            <span>Rate</span>
            <span>Change (24h)</span>
            <span>Chart (24h)</span>
            <button type="button">Edit</button>
          </div>
        `;
        const rows = marketCurrencyRows
          .filter((row) => currencyByCode(row.code))
          .map((row, index) => {
            const currency = currencyByCode(row.code);
            const movement = tickMovement(currency, index);
            const previous = floatingRate(currency, index, -1);
            const amount = row.code === "USD" ? 1 : (inverse ? 1 / movement.current : movement.current);
            const previousAmount = row.code === "USD" ? 1 : (inverse ? 1 / previous : previous);
            const displayPercent = previousAmount ? ((amount - previousAmount) / previousAmount) * 100 : 0;
            const positive = displayPercent >= 0;
            const chartPath = sparklinePath(row.code, index, positive);
            if (row.code === "USD") {
              return `
                <div class="market-row currency-rate-row base-rate-row">
                  <div class="market-pair"><span class="pair-icon flag-icon">${row.flag}</span><div><div class="pair-name">${row.label}</div><div class="pair-sub">Base currency</div></div></div>
                  <div class="market-price">1</div>
                  <div class="market-change"></div>
                  <div class="market-chart"></div>
                  <div></div>
                </div>
              `;
            }
            return `
              <div class="market-row currency-rate-row">
                <div class="market-pair"><span class="pair-icon flag-icon">${row.flag}</span><div><div class="pair-name">${row.label}</div><div class="pair-sub">${inverse ? `1 USD = ${formatMarketAmount(amount)} ${row.code}` : `1 ${row.code} = ${formatMarketAmount(amount)} USD`}</div></div></div>
                <div class="market-price">${formatMarketAmount(amount)}</div>
                <div class="market-change ${positive ? "positive" : "negative"}">${positive ? "+" : ""}${displayPercent.toFixed(4)}%</div>
                <div class="market-chart"><svg viewBox="0 0 140 64" preserveAspectRatio="none"><path d="${chartPath}"></path></svg></div>
                <button type="button" class="send-rate-button"><span aria-hidden="true">&#9993;</span> Send</button>
              </div>
            `;
          }).join("");
        card.innerHTML = header + rows;
        document.getElementById("marketInverse")?.addEventListener("change", renderMarketRows);
        return;
      }
      const header = card.querySelector(".market-list-header")?.outerHTML || '<div class="market-list-header"><span>Pair</span><span>Last Price</span><span>Change</span></div>';
      const rows = tradingPairs()
        .map(([base, quote], index) => {
          const movement = pairMovement(base, quote, index);
          const volume = (Math.abs(fluctuationSeed(base + quote, index)) * 900000 + 12000).toLocaleString(undefined, { maximumFractionDigits: 3 });
          return `
            <div class="market-row">
              <div class="market-pair"><span class="pair-icon" aria-hidden="true">&#128181;</span><div><div class="pair-name">${base}/${quote}</div><div class="pair-sub">VOL ${volume}</div></div></div>
              <div class="market-price">${formatRate(movement.current)}</div>
              <div class="market-change ${movement.percent >= 0 ? "positive" : "negative"}">${movement.percent >= 0 ? "+" : ""}${movement.percent.toFixed(2)}%</div>
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
    renderTradePage();
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
    bindTradingPage();
    enhanceAccountPage();
    renderDynamicMarkets();
    setInterval(renderDynamicMarkets, FLUCTUATION_INTERVAL_MS);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", DemoExchange.init);

