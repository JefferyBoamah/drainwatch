'use strict';
// Shared by join.html (residents) and login.html (crew and assembly staff).
// Both pages use the same element ids and the same API. The server decides the role from the phone number:
// the seeded admin number is admin, invited numbers are crew, and every other number becomes a reporter.
(function () {
  const token = DW.store.get(DW.TOKEN_KEY);
  const role = DW.store.get(DW.ROLE_KEY);
  if (token && DW.HOME[role]) {
    location.replace(DW.HOME[role]);
    return;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('Service worker did not register', err); });
  }
  const $ = function (id) { return document.getElementById(id); };
  let phone = '';

  async function requestCode() {
    $('send-code').disabled = true;
    $('resend-code').disabled = true;
    try {
      await DW.api('/api/auth/request-otp', { method: 'POST', body: { phone: phone }, noRedirect: true });
      $('phone-form').hidden = true;
      $('code-form').hidden = false;
      $('code').value = '';
      $('code').focus();
      DW.say(DW.S.codeSent);
    } catch (err) {
      DW.say(DW.errText(err));
    } finally {
      $('send-code').disabled = false;
      $('resend-code').disabled = false;
    }
  }

  $('phone-form').addEventListener('submit', function (e) {
    e.preventDefault();
    phone = $('phone').value.trim();
    if (!phone) {
      DW.say(DW.S.errors.bad_phone);
      $('phone').focus();
      return;
    }
    requestCode();
  });

  $('resend-code').addEventListener('click', requestCode);

  $('change-phone').addEventListener('click', function () {
    $('code-form').hidden = true;
    $('phone-form').hidden = false;
    $('phone').focus();
  });

  $('code-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) {
      DW.say(DW.S.errors.bad_code);
      $('code').focus();
      return;
    }
    $('verify-code').disabled = true;
    try {
      const data = await DW.api('/api/auth/verify', { method: 'POST', body: { phone: phone, code: code }, noRedirect: true });
      DW.store.set(DW.TOKEN_KEY, data.token);
      DW.store.set(DW.ROLE_KEY, data.role);
      DW.say(DW.S.signingIn);
      location.replace(DW.HOME[data.role] || 'index.html');
    } catch (err) {
      DW.say(DW.errText(err));
      $('code').focus();
    } finally {
      $('verify-code').disabled = false;
    }
  });
})();
