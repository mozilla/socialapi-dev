Cu.import("resource://socialdev/modules/registry.js");
Cu.import("resource://gre/modules/Services.jsm");

function test() {
  runTests(tests);
}

function doValidationTest(location, rawManifest, cb) {
  let r = registry();
  let origin = Services.io.newURI(location, null, null).prePath;
  try {
    let manifest = r.manifestRegistry.validateManifest(location, rawManifest);
    cb(manifest);
  } catch(e) {
    info("validation exception "+e.toString());
    cb(undefined);
  }
}

function doInstallTest(location, rawManifest, cb) {
  let r = registry();
  try {
    r.manifestRegistry.importManifest(null, location, rawManifest, true, cb);
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
    doInstallTest("resource://socialdev/app.manifest",{
        "services": {
          "social": {
            "name": "Test Overwrite Provider",
            "iconURL": "icon.png",
            "workerURL": "https://example.com/worker.js",
            "sidebarURL": "https://example.com/sidebar.htm",
            "URLPrefix": "https://example.com"
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
      doInstallTest("resource://socialdev/app.manifest",{
        "services": {
          "social": {
            "name": "Test Overwrite Provider",
            "iconURL": "icon.png",
            "workerURL": "https://example.com/worker.js",
            "sidebarURL": "https://example.com/sidebar.htm",
            "URLPrefix": "https://example.com"
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
    let url = TEST_PROVIDER_MANIFEST;
    let r = registry();
    r.manifestRegistry.loadManifest(null, url, true, function() {
      let origin = Services.io.newURI(url, null, null).prePath;
      let provider = r.get(origin);
      isnot(provider, undefined, "manifest loading via XHR");
      removeProvider(origin, function() {
        cbnext();
      });
    });
  }
};
