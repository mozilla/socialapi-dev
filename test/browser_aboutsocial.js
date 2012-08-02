Cu.import("resource://socialapi/modules/ProviderRegistry.jsm");

// test about:social.
function test() {
  waitForExplicitFinish();
  let tab1 = gBrowser.addTab("about:social");
  let tab2;
  let newTabBrowser = gBrowser.getBrowserForTab(tab1);

  newTabBrowser.addEventListener("load", function onLoad1() {
    newTabBrowser.removeEventListener("load", onLoad1, true);
    let doc1 = newTabBrowser.contentDocument;

    tab2 = gBrowser.addTab("about:social");
    newTabBrowser = gBrowser.getBrowserForTab(tab2);
    newTabBrowser.addEventListener("load", function onLoad2() {
      newTabBrowser.removeEventListener("load", onLoad2, true);
      let doc2 = newTabBrowser.contentDocument;

      // have 2 about:social tabs ready to roll.
      let providersDiv1 = doc1.getElementById("available-activities");
      let enableBut1 = doc1.getElementById("social-enabled");
      let providersDiv2 = doc1.getElementById("available-activities");
      let enableBut2 = doc1.getElementById("social-enabled");
      is(providersDiv1.hasChildNodes(), false, "should be nothing in the first activities div");
      is(providersDiv2.hasChildNodes(), false, "should be nothing in the second activities div");
      is(enableBut1.checked, false, "enable button 1 should be unchecked");
      is(enableBut2.checked, false, "enable button 2 should be unchecked");

      // install the provider - the divs should notice it.
      installTestProvider(function() {
        executeSoon(function() {
          is(providersDiv1.hasChildNodes(), true, "should be children in the first activities div");
          is(providersDiv2.hasChildNodes(), true, "should be children in the second activities div");
          // enable social.
          registry().enabled = true;
          // give the content a chance to respond to the observers etc.
          executeSoon(function() {
            // buttons should be checked.
            is(enableBut1.checked, true, "enable button 1 should be checked");
            is(enableBut2.checked, true, "enable button 2 should be checked");
            EventUtils.sendMouseEvent({type: "click"}, "social-enabled", newTabBrowser.contentWindow);
            executeSoon(function() {
              // that should have disabled social.
              is(registry().enabled, false, "social should be disabled");
              // *sigh* the postMessage takes its own sweet time to get to the html...
              executeSoon(function() {
                is(enableBut1.checked, false, "enable button 1 should not be checked");
                is(enableBut2.checked, false, "enable button 2 should not be checked");
                // Now remove the provider and ensure the HTML responds.
                removeProvider(TEST_PROVIDER_ORIGIN, function() {
                  is(providersDiv1.hasChildNodes(), false, "should be nothing in the first activities div");
                  is(providersDiv2.hasChildNodes(), false, "should be nothing in the second activities div");
                  finish();
                });
              });
            });
          })
        })
      })
    }, true);
  }, true);
  registerCleanupFunction(function() {
    gBrowser.removeTab(tab1);
    gBrowser.removeTab(tab2);
  });
}
