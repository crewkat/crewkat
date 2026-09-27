(() => {
  "use strict";

  const shareHashes = ["#portal=", "#document=", "#booking="];
  if (shareHashes.some((prefix) => window.location.hash.startsWith(prefix))) {
    window.location.replace("/app" + window.location.hash);
    return;
  }

  const ready = (callback) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  };

  ready(() => {
    const header = document.querySelector("[data-header]");
    const navToggle = document.querySelector("[data-nav-toggle]");
    const navMenu = document.querySelector("[data-nav-menu]");

    const closeMenu = () => {
      if (!navToggle || !navMenu) return;
      navToggle.setAttribute("aria-expanded", "false");
      navToggle.setAttribute("aria-label", "Open menu");
      navMenu.classList.remove("open");
    };

    if (navToggle && navMenu) {
      navToggle.addEventListener("click", () => {
        const isOpen = navToggle.getAttribute("aria-expanded") === "true";
        navToggle.setAttribute("aria-expanded", String(!isOpen));
        navToggle.setAttribute("aria-label", isOpen ? "Open menu" : "Close menu");
        navMenu.classList.toggle("open", !isOpen);
      });

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (!navMenu.contains(target) && !navToggle.contains(target)) closeMenu();
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeMenu();
          navToggle.focus();
        }
      });
    }

    const setHeaderState = () => {
      if (header) header.classList.toggle("scrolled", window.scrollY > 8);
    };
    setHeaderState();
    window.addEventListener("scroll", setHeaderState, { passive: true });

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (event) => {
        const rawHref = link.getAttribute("href");
        if (!rawHref || rawHref === "#") return;
        const target = document.querySelector(rawHref);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start"
        });
        window.history.replaceState(null, "", rawHref);
        closeMenu();
      });
    });

    document.querySelectorAll("[data-faq-button]").forEach((button) => {
      button.addEventListener("click", () => {
        const answerId = button.getAttribute("aria-controls");
        const answer = answerId ? document.getElementById(answerId) : null;
        if (!answer) return;
        const willOpen = button.getAttribute("aria-expanded") !== "true";

        document.querySelectorAll("[data-faq-button]").forEach((otherButton) => {
          const otherId = otherButton.getAttribute("aria-controls");
          const otherAnswer = otherId ? document.getElementById(otherId) : null;
          otherButton.setAttribute("aria-expanded", "false");
          if (otherAnswer) otherAnswer.hidden = true;
        });

        button.setAttribute("aria-expanded", String(willOpen));
        answer.hidden = !willOpen;
      });
    });

    let deferredInstallPrompt = null;
    const installButton = document.querySelector("[data-install-button]");
    const installFeedback = document.querySelector("[data-install-feedback]");

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (installButton instanceof HTMLElement) installButton.hidden = false;
    });

    if (installButton) {
      installButton.addEventListener("click", async () => {
        if (!deferredInstallPrompt) {
          if (installFeedback) installFeedback.textContent = "Use your browser menu and choose Add to Home Screen.";
          return;
        }

        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (installFeedback) {
          installFeedback.textContent = choice.outcome === "accepted"
            ? "Crewkat is being added to your phone."
            : "You can install Crewkat later from your browser menu.";
        }
        deferredInstallPrompt = null;
        if (installButton instanceof HTMLElement) installButton.hidden = true;
      });
    }

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      if (installButton instanceof HTMLElement) installButton.hidden = true;
      if (installFeedback) installFeedback.textContent = "Crewkat is installed.";
    });
  });
})();
