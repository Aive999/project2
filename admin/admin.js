document.getElementById("loginForm").addEventListener("submit", function(e){

e.preventDefault();


let username = document.getElementById("username").value;
let password = document.getElementById("password").value;


// temporary login
if(username === "admin" && password === "admin@12345"){

localStorage.setItem("adminLogin","true");

window.location.href="admin.html";

}else{

document.getElementById("error").innerHTML="Invalid login";

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
