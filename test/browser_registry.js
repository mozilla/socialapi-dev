Cu.import("resource://socialdev/modules/registry.js");
Cu.import("resource://gre/modules/Services.jsm");

function test() {
  let r = registry();
  let oc = new observerChecker(["social-browsing-current-service-changed",
                                "social-service-manifest-changed",
                                "social-browsing-enabled",
                                "social-browsing-disabled"]);
  
  waitForExplicitFinish();

  registerCleanupFunction(function() {
    oc.terminate();
  });

  is(window.social.enabled, false, "social should be disabled on first run");
  is(r.enabled, false, "registry should indicate disabled");
  is(r.currentProvider, null, "must be no current provider when disabled.");

  // attempt to enable it - it should fail as we have no providers.
  r.enabled = true;
  is(window.social.enabled, false, "social should fail to become enabled when no providers");
  // and no notifications should have been sent above.
  oc.check([]);

  // we need a provider to use for further testing...
  installTestProvider(function() {
    // now we can enable it.
    r.enabled = true;
    is(window.social.enabled, true, "social should enable as there is now a provider");
    is(r.currentProvider.origin, TEST_PROVIDER_ORIGIN, "check current test provider");
    oc.check([{topic: "social-service-manifest-changed"},
              {topic: "social-browsing-enabled"},
              {topic: "social-browsing-current-service-changed"}
            ]);
    // disable our test provider - that should disable social.
    r.disableProvider(TEST_PROVIDER_ORIGIN);
    // observers are called async, so wait for that to happen.
    executeSoon(function() {
      is(r.enabled, false, "social should be disabled after disabling only provider");
      oc.check([{topic: "social-browsing-disabled"},
                {topic: "social-service-manifest-changed"}]);

      // re-enable it.
      r.enableProvider(TEST_PROVIDER_ORIGIN);
      executeSoon(function() {
        // but social should still be disabled.
        is(r.enabled, false, "social should remain disabled after enabling only provider");
        r.enabled = true;
        oc.check([{topic: "social-service-manifest-changed"},
                  {topic: "social-browsing-enabled"},
                  {topic: "social-browsing-current-service-changed"}
                 ]);

        // disable browsing.
        r.enabled = false;
        is(window.social.enabled, false, "social should be disabled");
        oc.check([{topic: "social-browsing-disabled"}]);
        finish();
      })
    })
  });
}
