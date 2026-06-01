(function () {
  function render() {
    return `
      <div class="login-shell">
        <form class="login-card" id="login-form" novalidate>
          <div class="login-wordmark">IRIS</div>
          <div class="login-tagline">IUCN Red List · Information System</div>
          <div class="login-from">a project of <strong>NYBG</strong></div>

          <div class="login-form" style="margin-top: 22px;">
            <div class="login-error" id="login-error"></div>

            <div>
              <label class="field-label" for="login-email">Email</label>
              <input class="input" id="login-email" type="email" autocomplete="username"
                     placeholder="you@institution.org" required />
            </div>

            <div>
              <label class="field-label" for="login-password">Password</label>
              <input class="input" id="login-password" type="password"
                     autocomplete="current-password" required />
            </div>

            <button class="btn primary" id="login-submit" type="submit">Sign in</button>
          </div>

          <div class="login-hint">
            Phase 0 dev accounts &middot; password <code>1234</code><br/>
            <code>admin@gmail.com</code> &middot;
            <code>owner@gmail.com</code> &middot;
            <code>editor@gmail.com</code> &middot;
            <code>uploader@gmail.com</code>
          </div>
        </form>
      </div>
    `;
  }

  function mount(root) {
    root.innerHTML = render();
    const form = root.querySelector('#login-form');
    const errEl = root.querySelector('#login-error');
    const submitBtn = root.querySelector('#login-submit');
    const emailEl = root.querySelector('#login-email');
    const passEl  = root.querySelector('#login-password');

    // Dev convenience: in unpackaged builds, pre-fill the admin dev account.
    // To sign in as a different role, just retype the email (one field) and
    // press Enter — the password is the same for all four seeded accounts.
    // Packaged builds keep the form blank.
    window.IRIS.api.updater.info().then(info => {
      if (info && info.packaged === false) {
        emailEl.value = 'admin@gmail.com';
        passEl.value  = '1234';
        submitBtn.focus();
      }
    }).catch(() => { /* no-op */ });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.remove('show');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in…';
      try {
        await window.IRIS.session.login({
          email: emailEl.value.trim(),
          password: passEl.value,
        });
        // session.onChange → router.boot() will re-render app shell.
      } catch (err) {
        errEl.textContent = err.message || 'Sign-in failed.';
        errEl.classList.add('show');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      }
    });

    emailEl.focus();
  }

  window.IRIS = window.IRIS || {};
  window.IRIS.LoginPage = { mount };
})();
