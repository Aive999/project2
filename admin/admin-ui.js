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
      if (!text || /[Ãðâä]/.test(text)) {
        button.textContent = button.getAttribute("onclick") ? "CN" : "Settings";
      }
    });

    $$(".table-btn").forEach((button) => {
      const text = button.textContent.toLowerCase();
      if (text.includes("query") || /[Ãð]/.test(text)) button.textContent = "Query";
      if (text.includes("table") || text.includes("control") || text.includes("¦")) button.textContent = "Table Control";
    });

    $$(".empty-box").forEach((box) => {
      const label = $("p", box)?.textContent?.replace("No Date", "No Data") || "No Data";
      box.innerHTML = `<div class="empty-icon">No records</div><p>${label}</p>`;
    });

    $$("td").forEach((cell) => {
      if (cell.closest("#ll-body") || cell.querySelector("[data-action='delete']")) return;
      if (/[Ãðâ]/.test(cell.textContent)) {
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
    return records.map((record) => `
      <tr>
        <td><input type="checkbox"></td>
        <td>${record.account}</td>
        <td>${record.name}</td>
        <td>${record.network}</td>
        <td>${record.currency}</td>
        ${isDeposit
          ? `<td>${record.address}</td><td>${money(record.amount)}</td><td>${record.detail || "Server"}</td><td>${record.time}</td><td>${record.status}</td>`
          : `<td>${record.currency}</td><td>${record.address}</td><td>${money(record.amount)}</td><td>${record.time}</td>`}
        <td><button class="row-action" data-action="view">View</button><button class="row-action" data-action="edit">Edit</button></td>
      </tr>
    `).join("");
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
      const data = await adminApi("admin_transactions", { type });
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
    const routes = [
      ["Primary certification", "primary-real-name.html"],
      ["Advanced Certification", "advanced-real-name.html"],
      ["Withdrawal Review", "withdrawal-records.html"],
      ["Currency orders", "currency-order-records.html"],
      ["Recharge Review", "recharge-review.html"]
    ];
    $$(".admin-pill").forEach((button) => {
      button.addEventListener("click", () => {
        const text = button.textContent;
        if (text.includes("voice")) {
          button.classList.toggle("active");
          showToast(button.classList.contains("active") ? "Voice broadcast started." : "Voice broadcast stopped.");
          return;
        }
        const route = routes.find(([label]) => text.includes(label));
        if (route) window.location.href = route[1];
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
      if (action.closest("#ll-body") || action.closest("#user-table-body") || action.closest("#account-table-body")) return;
      const row = action.closest("tr");
      if (!row) return;
      const table = row.closest("table");
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
      const cells = $$("td", row).map((td) => td.textContent.trim()).filter(Boolean);
      alert(cells.join("\n"));
      showToast(`Viewing record ${cells[1] || cells[0] || ""}.`);
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();




