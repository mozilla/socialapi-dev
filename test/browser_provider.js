Cu.import("resource://socialdev/modules/registry.js");
Cu.import("resource://gre/modules/Services.jsm");

function test() {
  // we need a provider for all these tests.
  waitForExplicitFinish();
  installTestProvider(function() {
    dump("SET ENABLED!\n");
    registry().enabled = true;
    dump("PROVIDER TEST STARTUP - did enable - now " +registry().enabled + "\n");
  
    registerCleanupFunction(function() {
      if (isSidebarVisible()) {
        window.social_sidebar_toggle();
      }
      registry().enabled = false;
      removeTestProvider();
    });
  
    runTests(tests);
  });
    
}

let tests = {
  testWindowsClose: function(cbnext) {
    let countServiceWindows = function() {
      let windows = Services.wm.getEnumerator(null);
      let result = 0;
      while (windows.hasMoreElements()) {
        let w = windows.getNext();
        // WTF?  Sometimes we have w.document == "XUL Document ..." but it has
        // no getAttribute??  Must be an artifact of the test harness?
        if (w.document.documentElement.getAttribute("windowtype") == "socialdev:window" &&
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
        // disable the provider.
        ok(registry().disableProvider(registry().currentProvider.origin), "check disable of provider");
        // should be zero now.
        is(countServiceWindows(), 0, "check no social windows after disabling provider");
        // the sidebar should also have closed as the sole provider was disabled.
        ok(!isSidebarVisible(), "check sidebar no longer visible");
        cbnext();
      }
      sidebarWindow.wrappedJSObject.navigator.mozSocial.openServiceWindow(sidebarWindow.location.href,
                                                          "test", {}, "test", onopen);
    });
  }
}
