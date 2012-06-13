Cu.import("resource://socialapi/modules/ProviderRegistry.jsm");
Cu.import("resource://gre/modules/Services.jsm");

function test() {
  // we need a provider for all these tests.
  let cbPreTest = function(cb) {
    installTestProvider(function() {
      registry().enabled = true;
      cb();
    });
  };
  let cbPostTest = function(cb) {
    if (isSidebarVisible()) {
      window.social_sidebar_toggle();
    }
    registry().enabled = false;
    removeProvider(TEST_PROVIDER_ORIGIN);
    resetPrefs();
    cb();
  }
  runTests(tests, cbPreTest, cbPostTest);
}

let tests = {
  testWindowsClose: function(cbnext, disableProvider) {
    let countServiceWindows = function() {
      let windows = Services.wm.getEnumerator(null);
      let result = 0;
      while (windows.hasMoreElements()) {
        let w = windows.getNext();
        if (w.document.documentElement.getAttribute("windowtype") == "socialapi:window" &&
            !w.closed) {
          result += 1;
        }
      }
      return result;
    }
    openSidebar(function(sidebarWindow) {
      // there should be no service windows open now.
      is(countServiceWindows(), 0, "check no social windows before test");
      // open a "service window" - just use the same location as the sidebar.
      let onopen = function() {
        // so our window is open - now disable our provider.
        is(countServiceWindows(), 1, "check one social windows after creating it");
        if (disableProvider) {
          // disable the provider.
          ok(registry().disableProvider(registry().currentProvider.origin), "check disable of provider");
        } else {
          // disable the world rather than just one provider.
          registry().enabled = false;
        }
        // should be zero now.
        is(countServiceWindows(), 0, "check no social windows after disabling provider");
        // the sidebar should also have closed as the sole provider was disabled.
        ok(!isSidebarVisible(), "check sidebar no longer visible");
        cbnext();
      }
      sidebarWindow.wrappedJSObject.navigator.mozSocial.openServiceWindow(sidebarWindow.location.href,
                                                          "test", {}, "test", onopen);
    });
  },

  testWindowsCloseProvider: function(cbnext) {
    return this.testWindowsClose(cbnext, true);
  }
}
