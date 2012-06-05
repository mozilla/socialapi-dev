let registryModule = {} // work around the test framework complaining of leaks
Cu.import("resource://socialapi/modules/registry.js", registryModule);
Cu.import("resource://gre/modules/Services.jsm");

function registry() registryModule.registry();

function test() {
  runTests(tests, function(cb) {resetSocial(); executeSoon(cb);});
}

let tests = {
  testSingleProvider: function(cbnext) {
    let r = registry();
    
    let oc = new observerChecker(["social-browsing-current-service-changed",
                                  "social-service-manifest-changed",
                                  "social-browsing-enabled",
                                  "social-browsing-disabled"]);

    registerCleanupFunction(function() {
      oc.terminate();
    });

    is(r.enabled, false, "registry should indicate disabled");
    is(r.currentProvider, null, "must be no current provider when disabled.");

    // attempt to enable it - it should fail as we have no providers.
    r.enabled = true;
    is(r.enabled, false, "social should fail to become enabled when no providers");
    // and no notifications should have been sent above.
    oc.check([]);

    // we need a provider to use for further testing...
    installTestProvider(function() {
      // now we can enable it.
      r.enabled = true;
      is(r.enabled, true, "social should enable as there is now a provider");
      is(r.currentProvider.origin, TEST_PROVIDER_ORIGIN, "check current test provider");
      oc.check([{topic: "social-service-manifest-changed"},
                {topic: "social-browsing-enabled"},
                {topic: "social-browsing-current-service-changed"}
              ]);
      // disable our test provider - that should disable social.
      ok(r.disableProvider(TEST_PROVIDER_ORIGIN, function() {
        is(r.enabled, false, "social should be disabled after disabling only provider");
        oc.check([{topic: "social-browsing-disabled"},
                  {topic: "social-service-manifest-changed"}]);

        // re-enable it.
        ok(r.enableProvider(TEST_PROVIDER_ORIGIN, function() {
          // but social should still be disabled.
          is(r.enabled, false, "social should remain disabled after enabling only provider");
          r.enabled = true;
          oc.check([{topic: "social-service-manifest-changed"},
                    {topic: "social-browsing-enabled"},
                    {topic: "social-browsing-current-service-changed"}
                   ]);

          // disable browsing.
          r.enabled = false;
          is(r.enabled, false, "social should be disabled");
          oc.check([{topic: "social-browsing-disabled"}]);
          cbnext();
        }), "check provider was enabled");
      }), "check provider was disabled");
    });
  },

  testMultipleProviders: function(cbnext) {
    let r = registry();
    // install the first provider and enable social.
    installTestProvider(function() {
      // now we can enable it.
      r.enabled = true;
      is(r.currentProvider.origin, TEST_PROVIDER_ORIGIN, "check current test provider");
      // install the second - the first should remain current.
      installTestProvider(function() {
        is(r.currentProvider.origin, TEST_PROVIDER_ORIGIN, "check existing still current");
        // disable the first - second should go current.
        ok(r.disableProvider(TEST_PROVIDER_ORIGIN), "provider disabled ok");
        is(r.currentProvider.origin, TEST_PROVIDER2_ORIGIN, "check new provider made current");
        // re-enable the first and make it current.
        ok(r.enableProvider(TEST_PROVIDER_ORIGIN, function() {
          r.currentProvider = r.get(TEST_PROVIDER_ORIGIN);
          is(r.currentProvider.origin, TEST_PROVIDER_ORIGIN, "check old provider made current");
          // now delete the first provider - second should be current.
          removeProvider(TEST_PROVIDER_ORIGIN, function() {
            is(r.currentProvider.origin, TEST_PROVIDER2_ORIGIN, "check new provider made current");
            cbnext();
          })
        }), "check provider was enabled");
      }, TEST_PROVIDER2_MANIFEST);
    });
  },

  testProviderPortIgnored: function(cbnext) {
    let r = registry();
    // install a provider without the port specified, then attempt to install
    // it again with the port specified - the second should be ignored.
    const originWithPort = TEST_PROVIDER_ORIGIN + ":443";
    const manifestWithPort = originWithPort + TEST_PROVIDER_PATH + "/app.manifest";
    is(Object.keys(r._providers).length, 0, "should be zero installed at the start");
    installTestProvider(function() {
      is(Object.keys(r._providers).length, 1, "should be one installed now");
      // and again...
      installTestProvider(function() {
        is(Object.keys(r._providers).length, 1, "should still be one installed now");
        cbnext();
      }, manifestWithPort);
    });
  },

  testProviderCert: function(cbnext, origin) {
    // with no args this is testing the "no cert" case.
    if (!origin) origin = "https://nocert.example.com";
    let r = registry();
    const manifestUrl = origin + TEST_PROVIDER_PATH + "/app.manifest";;
    installTestProvider(function() {
      is(r.get(origin), undefined, "ensure provider didn't get installed");
      cbnext();
    }, manifestUrl);
  },

  testProviderUntrustedCert: function(cbnext) {
    this.testProviderCert(cbnext, "https://untrusted.example.com");
  },

  testProviderExpiredCert: function(cbnext) {
    this.testProviderCert(cbnext, "https://expired.example.com");
  },

}
