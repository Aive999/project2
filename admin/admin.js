function writeLoginLog(username, status) {
    const key = "adminLoginLog";
    const logs = JSON.parse(localStorage.getItem(key) || "[]");
    logs.unshift({
        id: "L" + Date.now(),
        user: username || "unknown",
        login: new Date().toLocaleString(),
        ip: "local",
        source: "Local browser",
        os: navigator.platform || "Unknown",
        browser: navigator.userAgent.includes("Chrome") ? "Chrome" : "Browser",
        type: /Mobi|Android/i.test(navigator.userAgent) ? "Mobile" : "Computer",
        status
    });
    localStorage.setItem(key, JSON.stringify(logs.slice(0, 100)));
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

function backendUnavailable(error) {
    const message = error?.message || "";
    return message.includes("Failed to fetch")
        || message.includes("Server request failed")
        || message.includes("SQLSTATE")
        || message.includes("Access denied")
        || message.includes("Unknown database")
        || message.includes("your_database_");
}

document.getElementById("loginForm").addEventListener("submit", async function(e){

e.preventDefault();


let username = document.getElementById("username").value;
let password = document.getElementById("password").value;


try {
    await adminApi("admin_login", { username, password });
    localStorage.setItem("adminLogin","true");
    window.location.href="admin.html";
    return;
} catch (error) {
    if (!backendUnavailable(error)) {
        document.getElementById("error").innerHTML=error.message || "Invalid login";
        return;
    }
}

// local setup fallback
if(username === "admin" && password === "admin@12345"){

localStorage.setItem("adminLogin","true");
writeLoginLog(username, "Success");

window.location.href="admin.html";

}else{

document.getElementById("error").innerHTML="Invalid login";
writeLoginLog(username, "Failed");

}

});

const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");

if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
        const isHidden = passwordInput.type === "password";

        passwordInput.type = isHidden ? "text" : "password";
        togglePassword.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
}
