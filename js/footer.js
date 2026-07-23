(function () {
  const version = window.APP_CONFIG?.APP_VERSION || "3.3";
  document.querySelectorAll("[data-app-version]").forEach((element) => {
    element.textContent = version;
  });
})();
