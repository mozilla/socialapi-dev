
function isSidebarVisible() {
  return document.getElementById("social-vbox").getAttribute("hidden") != "true";
}

function test() {
  runTests(tests, function(cb) {resetSocial(); cb()});
}
  
let tests = {
  testSidebarTests: function(cbnext) {
    let r = registry();
    let oc = new observerChecker(["social-sidebar-visible",
                                  "social-sidebar-hidden"]);
  
    registerCleanupFunction(function() {
      oc.terminate();
    });
  
    installTestProvider( function() {
      is(r.enabled, false, "social browsing should be disabled");
      // attempt to toggle the visibility of the sidebar itself - this should fail
      // so no observations.
      window.social_sidebar_toggle();
      oc.check([]);
      is(isSidebarVisible(), false, "sidebar should be invisible");
    
      // enable social then toggle the visibility.
      r.enabled = true;
      // this should have sent a "hidden" observer
      oc.check([{topic: "social-sidebar-hidden"}]);
    
      window.social_sidebar_toggle();
      oc.check([{topic: "social-sidebar-visible"}]);
      is(isSidebarVisible(), true, "sidebar should be visible");
    
      // attach a load listener to the browser so we can then get it to run
      // further checks.
      let browser = document.getElementById("social-status-sidebar-browser");
      browser.addEventListener("DOMContentLoaded", function browserlistener(evt) {
        browser.removeEventListener("DOMContentLoaded", browserlistener, true);
        is(browser.contentWindow.location.href, TEST_PROVIDER_ORIGIN + TEST_PROVIDER_PATH + "/sidebar.htm", "correct sidebar");
        // and run the tests that exist in that sidebar.
        let results = browser.contentWindow.wrappedJSObject.runTests();
        ok(results.length, "check some tests were actually run");
        for each (var result in results) {
          is(result.status, "ok", "check test " + result.name + (result.msg ? " - " + result.msg : ""));
        }
        cbnext();
      }, true);
    });
  },

  testSidebarChanges: function(cbnext) {
    let r = registry();
    installTestProvider( function() {
      r.enabled = true;
      window.social_sidebar_toggle();
      is(isSidebarVisible(), true, "sidebar should be visible");
    
      let browser = document.getElementById("social-status-sidebar-browser");
      browser.addEventListener("DOMContentLoaded", function browserlistener(evt) {
        browser.removeEventListener("DOMContentLoaded", browserlistener, true);
        is(browser.contentWindow.location.href, TEST_PROVIDER_ORIGIN + TEST_PROVIDER_PATH + "/sidebar.htm", "correct sidebar");
        // install a second provider.
        installTestProvider(function() {
          browser.addEventListener("DOMContentLoaded", function browserlistener(evt) {
            browser.removeEventListener("DOMContentLoaded", browserlistener, true);
            is(browser.contentWindow.location.href, TEST_PROVIDER2_ORIGIN + TEST_PROVIDER_PATH + "/sidebar.htm", "correct sidebar");
            cbnext();
          }, true);
          // disable the first provider - this should force the second
          // provider to be swapped into the sidebar.
          info("disabling " + TEST_PROVIDER_ORIGIN);
          ok(r.disableProvider(TEST_PROVIDER_ORIGIN), "disabled first provider");
        }, TEST_PROVIDER2_MANIFEST);
      }, true);
    });
  }
}
