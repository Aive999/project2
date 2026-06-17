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

document.getElementById("loginForm").addEventListener("submit", function(e){

e.preventDefault();


let username = document.getElementById("username").value;
let password = document.getElementById("password").value;


// temporary login
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
