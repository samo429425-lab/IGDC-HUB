/* auth-bridge.v2.js — IGDC OS Login Bridge */

(function(){

  const domain = "dev-5r3x0n7y.us.auth0.com";   // Auth0 Domain
  const clientId = "YOUR_AUTH0_CLIENT_ID";     // Auth0 Client ID
  const redirectUri = window.location.origin + "/callback.html";

  let auth0Client = null;

  async function initAuth(){
    auth0Client = await createAuth0Client({
      domain: domain,
      client_id: clientId,
      authorizationParams:{
        redirect_uri: redirectUri
      },
      cacheLocation: "localstorage",
      useRefreshTokens: true
    });

    // callback 처리
    if (window.location.pathname === "/callback.html") {
      await auth0Client.handleRedirectCallback();
      window.location.replace("/");
      return;
    }

    const isAuthenticated = await auth0Client.isAuthenticated();

    if (isAuthenticated) {
      const user = await auth0Client.getUser();
      showUser(user);
    } else {
      showLogin();
    }
  }

  function showUser(user){
    const ownerEl = document.getElementById("owner");
    const loginBtn = document.getElementById("os-login");
    const logoutBtn = document.getElementById("os-logout");

    if(ownerEl){
      ownerEl.textContent = user.name || user.email || "owner";
    }

    if(loginBtn) loginBtn.style.display = "none";
    if(logoutBtn) logoutBtn.style.display = "inline-block";
  }

  function showLogin(){
    const loginBtn = document.getElementById("os-login");
    const logoutBtn = document.getElementById("os-logout");

    if(loginBtn) loginBtn.style.display = "inline-block";
    if(logoutBtn) logoutBtn.style.display = "none";
  }

  async function login(){
    await auth0Client.loginWithRedirect({
      authorizationParams:{
        redirect_uri: redirectUri
      }
    });
  }

  async function logout(){
    auth0Client.logout({
      logoutParams:{
        returnTo: window.location.origin
      }
    });
  }

  window.OSLogin = login;
  window.OSLogout = logout;

  window.addEventListener("load", initAuth);

})();