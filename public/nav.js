// Shared navigation behavior (mobile + iOS Safari safe)
// Used across ALL pages (dashboard + tools) without depending on Chart.js or page-specific DOM.

(function () {
  function closestNavDropdown(target) {
    try {
      if (!target) return null;
      // iOS Safari can report a Text node as the event target
      var el = null;
      if (target.nodeType === 1) el = target; // Element
      else if (target.nodeType === 3) el = target.parentElement; // Text
      if (!el || !el.closest) return null;
      return el.closest('.nav-dropdown');
    } catch (e) {
      return null;
    }
  }

  function closeAllNavDropdowns() {
    document.querySelectorAll('.nav-dropdown.open').forEach(function (dd) {
      dd.classList.remove('open');
    });
  }

  // Mobile: allow tapping Tools dropdown to open/close
  window.toggleMobileToolsMenu = function (e) {
    try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
    var dd = closestNavDropdown(e && e.target);
    if (!dd) return;
    dd.classList.toggle('open');
  };

  function handleOutsideNavDropdown(e) {
    var dd = closestNavDropdown(e && e.target);
    if (dd) return; // tap/click inside dropdown; leave it open so links can navigate
    closeAllNavDropdowns();
  }

  document.addEventListener('click', handleOutsideNavDropdown);
  // iOS Safari: touchstart fires before click
  document.addEventListener('touchstart', handleOutsideNavDropdown, { passive: true });
})();
