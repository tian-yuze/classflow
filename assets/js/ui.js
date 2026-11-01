/* 课序 ClassFlow — 弹窗、确认框与提示 */
(function () {
  'use strict';
  var CF = window.CF = window.CF || {};
  var U = CF.Util;
  var UI = CF.UI = {};

  var modalRoot, confirmRoot, toastRoot;
  var current = null;
  var confirmState = null;
  var lastFocus = null;
  var lastConfirmFocus = null;

  function roots() {
    modalRoot = modalRoot || document.getElementById('modal-root');
    confirmRoot = confirmRoot || document.getElementById('confirm-root');
    toastRoot = toastRoot || document.getElementById('toast-root');
    return { modalRoot: modalRoot, confirmRoot: confirmRoot, toastRoot: toastRoot };
  }

  function trapTab(e, container) {
    if (e.key !== 'Tab' || !container) return;
    var items = Array.prototype.slice.call(container.querySelectorAll('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    if (!items.length) { e.preventDefault(); return; }
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  }

  function lockBody(lock) {
    var any = (modalRoot && modalRoot.classList.contains('is-open')) || (confirmRoot && confirmRoot.classList.contains('is-open'));
    if (lock) document.body.classList.add('modal-open');
    else if (!any) document.body.classList.remove('modal-open');
  }

  UI.isModalOpen = function () { return !!(current || confirmState); };
  UI.isCourseModalOpen = function () { return !!current; };

  /* ---------- 主弹窗 ---------- */
  UI.openModal = function (options) {
    options = options || {};
    roots();
    if (current) UI.closeModal(true);
    lastFocus = document.activeElement;

    var sizeClass = options.size === 'sm' ? ' modal-sm' : (options.size === 'lg' ? ' modal-lg' : (options.size === 'xl' ? ' modal-xl' : ''));
    var wrap = document.createElement('div');
    wrap.className = 'modal-layer is-open';
    wrap.innerHTML =
      '<div class="modal-backdrop" data-modal-close="1"></div>' +
      '<section class="modal' + sizeClass + (options.className ? ' ' + options.className : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">' +
        '<header class="modal-head">' +
          '<div class="modal-heading">' +
            '<h2 class="modal-title" id="modal-title">' + U.esc(options.title || '') + '</h2>' +
            (options.subtitle ? '<p class="modal-subtitle">' + U.esc(options.subtitle) + '</p>' : '') +
          '</div>' +
          '<button class="icon-btn modal-close" type="button" data-modal-close="1" aria-label="关闭">' + U.icon('close') + '</button>' +
        '</header>' +
        '<div class="modal-body"></div>' +
        (options.footer ? '<footer class="modal-foot"></footer>' : '') +
      '</section>';

    modalRoot.innerHTML = '';
    modalRoot.appendChild(wrap);
    modalRoot.classList.add('is-open');

    var panel = wrap.querySelector('.modal');
    var body = wrap.querySelector('.modal-body');
    if (options.body instanceof Node) body.appendChild(options.body);
    else body.innerHTML = options.body || '';

    var foot = wrap.querySelector('.modal-foot');
    if (foot) {
      if (options.footer instanceof Node) foot.appendChild(options.footer);
      else foot.innerHTML = options.footer || '';
    }

    current = {
      wrap: wrap,
      panel: panel,
      body: body,
      foot: foot,
      options: options
    };

    wrap.addEventListener('click', function (e) {
      var closer = e.target.closest('[data-modal-close]');
      if (closer) { e.preventDefault(); UI.closeModal(); }
    });

    lockBody(true);
    setTimeout(function () {
      var target = panel.querySelector('[autofocus]') || panel.querySelector('input:not([type="hidden"]), textarea, select, button.btn-primary');
      (target || panel).focus({ preventScroll: true });
      if (options.onMount) options.onMount(panel, body, foot);
    }, 0);
    return current;
  };

  UI.closeModal = function (silent) {
    if (!current) return;
    var c = current;
    if (c.options && typeof c.options.onClose === 'function' && !silent) {
      try { if (c.options.onClose() === false) return; } catch (e) {}
    }
    current = null;
    if (c.wrap && c.wrap.parentNode) c.wrap.parentNode.removeChild(c.wrap);
    if (modalRoot) { modalRoot.classList.remove('is-open'); modalRoot.innerHTML = ''; }
    lockBody(false);
    if (!silent && lastFocus && document.body.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  };

  UI.modalBody = function () { return current ? current.body : null; };
  UI.modalPanel = function () { return current ? current.panel : null; };

  /* ---------- 确认框 ---------- */
  UI.confirm = function (options) {
    options = options || {};
    roots();
    if (confirmState) { UI.closeConfirm(false); }
    lastConfirmFocus = document.activeElement;

    var wrap = document.createElement('div');
    wrap.className = 'confirm-layer is-open';
    wrap.innerHTML =
      '<div class="confirm-backdrop" data-confirm-cancel="1"></div>' +
      '<section class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1">' +
        '<div class="confirm-icon ' + (options.danger ? 'danger' : '') + '">' + U.icon(options.danger ? 'alert' : 'info') + '</div>' +
        '<div class="confirm-content">' +
          '<h3 id="confirm-title">' + U.esc(options.title || '确认操作') + '</h3>' +
          '<p>' + (options.message || '') + '</p>' +
          (options.detail ? '<p class="confirm-detail">' + U.esc(options.detail) + '</p>' : '') +
        '</div>' +
        '<div class="confirm-actions">' +
          '<button type="button" class="btn btn-ghost" data-confirm-cancel="1">' + U.esc(options.cancelText || '取消') + '</button>' +
          '<button type="button" class="btn ' + (options.danger ? 'btn-danger' : 'btn-primary') + '" data-confirm-ok="1">' + U.esc(options.confirmText || '确定') + '</button>' +
        '</div>' +
      '</section>';

    confirmRoot.innerHTML = '';
    confirmRoot.appendChild(wrap);
    confirmRoot.classList.add('is-open');

    return new Promise(function (resolve) {
      confirmState = { wrap: wrap, resolve: resolve, prevFocus: lastConfirmFocus };
      wrap.addEventListener('click', function (e) {
        if (e.target.closest('[data-confirm-cancel]')) UI.closeConfirm(false);
        else if (e.target.closest('[data-confirm-ok]')) UI.closeConfirm(true);
      });
      lockBody(true);
      setTimeout(function () {
        var btn = wrap.querySelector('[data-confirm-ok]');
        if (btn) btn.focus();
      }, 0);
    });
  };

  UI.closeConfirm = function (ok) {
    if (!confirmState) return;
    var st = confirmState;
    confirmState = null;
    if (st.wrap && st.wrap.parentNode) st.wrap.parentNode.removeChild(st.wrap);
    if (confirmRoot) { confirmRoot.classList.remove('is-open'); confirmRoot.innerHTML = ''; }
    lockBody(false);
    if (st.prevFocus && document.body.contains(st.prevFocus)) {
      try { st.prevFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    st.resolve(!!ok);
  };

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', function (e) {
    if (confirmState) {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeConfirm(false); }
      else if (e.key === 'Tab') trapTab(e, confirmState.wrap.querySelector('.confirm-card'));
      return;
    }
    if (current) {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeModal(); }
      else if (e.key === 'Tab') trapTab(e, current.panel);
    }
  }, true);

  /* ---------- Toast ---------- */
  UI.toast = function (message, type, duration) {
    roots();
    if (!toastRoot) return;
    var kind = type || 'info';
    var iconName = kind === 'success' ? 'check' : (kind === 'error' ? 'alert' : (kind === 'warn' ? 'alert' : 'info'));
    var el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.innerHTML = '<span class="toast-icon">' + U.icon(iconName) + '</span><span class="toast-text">' + U.esc(message) + '</span><button type="button" class="toast-close" aria-label="关闭提示">' + U.icon('close') + '</button>';
    toastRoot.appendChild(el);
    var timer = setTimeout(function () { remove(); }, duration || 3600);
    function remove() {
      clearTimeout(timer);
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }
    el.querySelector('.toast-close').addEventListener('click', remove);
    while (toastRoot.children.length > 3) toastRoot.removeChild(toastRoot.firstChild);
  };

  UI.copy = function (text, successMsg) {
    return U.copyText(text).then(function () {
      UI.toast(successMsg || '已复制到剪贴板', 'success');
      return true;
    }).catch(function () {
      UI.toast('复制失败，请手动选择复制', 'error');
      return false;
    });
  };

  UI.download = function (filename, content, mime) {
    U.download(filename, content, mime);
  };
})();
