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