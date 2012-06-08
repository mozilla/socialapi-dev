Cu.import("resource://gre/modules/Services.jsm");
let modules = {} // work around the test framework complaining of leaks
Cu.import("resource://socialapi/modules/registry.js", modules);
Cu.import("resource://socialapi/modules/ManifestRegistry.jsm", modules);
Cu.import("resource://socialapi/modules/Discovery.jsm", modules);

function registry() modules.registry();

function test() {
  runTests(tests);
}

function doValidationTest(location, rawManifest, cb) {
  let r = registry();
  let origin = Services.io.newURI(location, null, null).prePath;
  try {
    let manifest = modules.ManifestRegistry.validate(location, rawManifest);
    cb(manifest);
  } catch(e) {
    info("validation exception "+e.toString());
    cb(undefined);
  }
}

function doInstallTest(location, rawManifest, cb) {
  try {
    modules.SocialProviderDiscovery.importManifest(null, location, rawManifest, true, cb);
  } catch(e) {
    info("install exception "+e.toString());
    cb(undefined);
  }
}

let tests = {
  testManifestOK: function (cbnext) {
    doValidationTest("https://example.com/app.manifest",{
      "services": {
        "social": {
          "name": "Test GOOD Provider",
          "iconURL": "icon.png",
          "workerURL": "worker.js",
          "sidebarURL": "sidebar.htm",
        }
      }
    }, function callback(manifest) {
      isnot(manifest, undefined, "manifest validated");
      cbnext();
    });
  },
  testManifestSameOriginFail: function (cbnext) {
    doValidationTest("https://example.com/app.manifest",{
      "services": {
        "social": {
          "name": "Test BAD Provider",
          "iconURL": "icon.png",
          "workerURL": "http://example.com/worker.js",
          "sidebarURL": "http://example.com/sidebar.htm",
        }
      }
    }, function callback(manifest) {
      is(manifest, undefined, "manifest validation with bad origin should fail");
      cbnext();
    });
  },
  testManifestBuiltinOverwriteOK: function (cbnext) {
    doInstallTest("resource://socialapi/app.manifest",{
        "services": {
          "social": {
            "name": "Test Overwrite Provider",
            "iconURL": "icon.png",
            "workerURL": "https://example.com/worker.js",
            "sidebarURL": "https://example.com/sidebar.htm",
            "origin": "https://example.com"
          }
        }
      },
      function callback(success) {
        // now try to overwrite it with a builtin
        doInstallTest("https://example.com/app.manifest",{
            "services": {
              "social": {
                "name": "Test Good Provider",
                "iconURL": "icon.png",
                "workerURL": "https://example.com/worker.js",
                "sidebarURL": "https://example.com/sidebar.htm",
              }
            }
          },
          function callback(success) {
            is(success, true, "overwriting builtin manifest with remote should work");
            removeProvider("https://example.com", function() {
              cbnext();
            });
        });
    });
  },
  testManifestBuiltinOverwriteFail: function (cbnext) {
    doInstallTest("https://example.com/app.manifest",{
      "services": {
        "social": {
          "name": "Test Good Provider",
          "iconURL": "icon.png",
          "workerURL": "https://example.com/worker.js",
          "sidebarURL": "https://example.com/sidebar.htm",
        }
      }
    },
    function callback(success) {
      // now try to overwrite it with a builtin
      doInstallTest("resource://socialapi/app.manifest",{
        "services": {
          "social": {
            "name": "Test Overwrite Provider",
            "iconURL": "icon.png",
            "workerURL": "https://example.com/worker.js",
            "sidebarURL": "https://example.com/sidebar.htm",
            "origin": "https://example.com"
          }
        }
      },
      function callback(success) {
        is(success, false, "overwriting remote manifest with builtin should fail");
        removeProvider("https://example.com", function() {
          cbnext();
        });
      });
    });
  },
  testManifestLoad: function(cbnext) {
    //// XXX - disabled for now.
    //todo(false, "need a test provider manifest!");
    //cbnext();
    //return;
    // XXX
    let url = TEST_PROVIDER_MANIFEST;
    let r = modules.registry();
    modules.SocialProviderDiscovery.loadManifest(null, url, true, function() {
      let origin = Services.io.newURI(url, null, null).prePath;
      let provider = r.get(origin);
      isnot(provider, undefined, "manifest loading via XHR");
      removeProvider(origin, function() {
        cbnext();
      });
    });
  }
};
