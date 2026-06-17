(function () {
  const isLoginPage = location.pathname.endsWith("/login.html");
  const loggedIn = localStorage.getItem("adminLogin") === "true";
  const pageName = location.pathname.split("/").pop() || "admin.html";

  if (!isLoginPage && !loggedIn) {
    window.location.href = "login.html";
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function readUsers() {
    return readJSON("demoExchangeUsers", {});
  }

  function readAdminAccounts() {
    return readJSON("adminAccountData", []);
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
        coin: tx.asset || "USDT",
        address: "local-wallet",
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
    const accounts = readAdminAccounts();
    const portfolioTotal = users.reduce((sum, user) => sum + Number(user.balances?.USDT || 0), 0) +
      accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
    const values = [
      users.length + accounts.length,
      users.length,
      money(portfolioTotal),
      money(portfolioTotal)
    ];
    cards.forEach((card, index) => {
      const value = $(".card-value", card);
      if (value) value.textContent = values[index] ?? value.textContent;
    });
  }

  function tableKey(index) {
    return `adminTable:${pageName}:${index}`;
  }

  function captureTable(table) {
    return {
      rows: $$("tbody tr", table)
        .filter((row) => !row.querySelector(".empty-box"))
        .map((row) => $$("td", row).map((cell) => cell.innerHTML.trim()))
    };
  }

  function renderStoredTable(table, data) {
    const tbody = $("tbody", table);
    if (!tbody || !data?.rows?.length) return;
    tbody.innerHTML = data.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  }

  function saveTable(table) {
    const index = $$("table").indexOf(table);
    if (index >= 0) writeJSON(tableKey(index), captureTable(table));
  }

  function persistTables() {
    $$("table").forEach((table, index) => {
      if ($("tbody", table)?.id === "ll-body") return;
      if ($("tbody", table)?.id === "account-table-body") return;
      const stored = readJSON(tableKey(index), null);
      if (stored?.rows?.length) {
        renderStoredTable(table, stored);
      } else {
        writeJSON(tableKey(index), captureTable(table));
      }
    });
  }

  function renderUserTransactionTable(type) {
    const tbody = $(".withdraw-table tbody");
    if (!tbody) return;
    const records = getUserTransactions(type);
    if (!records.length) return;
    const isDeposit = type === "Deposit";
    tbody.innerHTML = records.map((record) => `
      <tr>
        <td><input type="checkbox"></td>
        <td>${record.account}</td>
        <td>${record.name}</td>
        <td>${record.network}</td>
        <td>${record.coin}</td>
        ${isDeposit
          ? `<td>${record.address}</td><td>${money(record.amount)}</td><td>Local</td><td>${record.time}</td><td>${record.status}</td>`
          : `<td>${record.coin}</td><td>${record.address}</td><td>${money(record.amount)}</td><td>${record.time}</td>`}
        <td><button class="row-action" data-action="view">View</button><button class="row-action" data-action="edit">Edit</button></td>
      </tr>
    `).join("");
    saveTable(tbody.closest("table"));
  }

  function hydratePageData() {
    persistTables();
    if (pageName === "withdrawal-records.html" || pageName === "new-withdrawal-records.html") {
      renderUserTransactionTable("Withdraw");
    }
    if (pageName === "recharge-review.html" || pageName === "top-up-records.html") {
      renderUserTransactionTable("Deposit");
    }
  }

  function bindHeaderActions() {
    const routes = [
      ["Primary certification", "primary-real-name.html"],
      ["Advanced Certification", "advanced-real-name.html"],
      ["Withdrawal Review", "withdrawal-records.html"],
      ["Cycle contracts", "cycle-contracts-trades.html"],
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
      const row = action.closest("tr");
      const table = row.closest("table");
      if (action.dataset.action === "edit") {
        row.classList.toggle("admin-row-edited");
        if (table) saveTable(table);
      }
      const cells = $$("td", row).map((td) => td.textContent.trim()).filter(Boolean);
      showToast(`${action.dataset.action === "edit" ? "Updated" : "Viewing"} record ${cells[1] || cells[0] || ""}.`);
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
        showToast("Saved successfully.");
      });
    });
  }

  function exposeStore() {
    window.AdminStore = {
      read: readJSON,
      write: writeJSON,
      users: readUsers,
      accounts: readAdminAccounts,
      transactions: getUserTransactions
    };
  }

  function init() {
    exposeStore();
    hydratePageData();
    normalizeIcons();
    setActiveNavigation();
    bindMenuSearch();
    updateDashboardCards();
    bindHeaderActions();
    bindTables();
    bindGenericForms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
